#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreText/CoreText.h>
#include <dlfcn.h>
#include <execinfo.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <string>
#include <vector>
#include <mach/mach.h>
#include <libkern/OSCacheControl.h>

static void crashHandler(int sig) {
    void* array[64];
    int size = backtrace(array, 64);
    fprintf(stderr, "CRASH: signal %d\n", sig);
    backtrace_symbols_fd(array, size, STDERR_FILENO);
    _exit(128 + sig);
}

static void registerBundledFonts(const std::string& appBundlePath) {
    NSArray* fontSubdirs = @[
        @"Contents/Resources/Hnc/Shared/TTF/Install",
        @"Contents/Resources/Hnc/Shared/TTF/All",
        @"Contents/Resources/Hnc/Shared/TTF/Hwp"
    ];
    NSFileManager* fm = [NSFileManager defaultManager];
    NSString* base = [NSString stringWithUTF8String:appBundlePath.c_str()];
    for (NSString* sub in fontSubdirs) {
        NSString* dirPath = [base stringByAppendingPathComponent:sub];
        NSArray* files = [fm contentsOfDirectoryAtPath:dirPath error:nil];
        if (!files) continue;
        NSMutableArray* fontURLs = [NSMutableArray array];
        for (NSString* file in files) {
            NSString* ext = [[file pathExtension] lowercaseString];
            if ([ext isEqualToString:@"ttf"] || [ext isEqualToString:@"otf"] || [ext isEqualToString:@"ttc"]) {
                NSURL* u = [NSURL fileURLWithPath:[dirPath stringByAppendingPathComponent:file]];
                [fontURLs addObject:u];
            }
        }
        if (fontURLs.count > 0) {
            CTFontManagerRegisterFontURLs((CFArrayRef)fontURLs, kCTFontManagerScopeProcess, false, nil);
        }
    }
}

// Suppress Hancom editor guide marks (margin crop brackets ⌜ ⌝ ⌞ ⌟)
// while strictly preserving all document page margins and layout.
// By neutralizing CHwpView::_DrawPaperMargin with an immediate return ('ret'),
// the page margins (white space around text/tables) remain 100% intact,
// and only the editor's visual margin brackets are eliminated.
static void suppressMarginCropMarks(void* hHwpApp) {
    if (!hHwpApp) return;
    void* pDrawPaperMargin = dlsym(hHwpApp, "_ZNK8CHwpView16_DrawPaperMarginENSt3__110shared_ptrI10IHwpCanvasEEPKNS_12tagHWPVIEWLOEi");
    if (pDrawPaperMargin) {
        uintptr_t page = reinterpret_cast<uintptr_t>(pDrawPaperMargin) & ~static_cast<uintptr_t>(0x3fff);
        kern_return_t kr = vm_protect(mach_task_self(), static_cast<vm_address_t>(page), 0x4000, FALSE, VM_PROT_READ | VM_PROT_WRITE | VM_PROT_COPY);
        if (kr == KERN_SUCCESS) {
#if defined(__arm64__) || defined(__aarch64__)
            *reinterpret_cast<uint32_t*>(pDrawPaperMargin) = 0xd65f03c0; // ARM64 'ret'
            sys_icache_invalidate(pDrawPaperMargin, 4);
#else
            *reinterpret_cast<uint8_t*>(pDrawPaperMargin) = 0xc3; // x86_64 'ret'
#endif
            vm_protect(mach_task_self(), static_cast<vm_address_t>(page), 0x4000, FALSE, VM_PROT_READ | VM_PROT_EXECUTE);
        }
    }
}

struct tagRECT {
    int32_t left;
    int32_t top;
    int32_t right;
    int32_t bottom;
};

using SetStringFn = void (*)(const char*, const char*);
using GetStringFn = const char* (*)(const char*);
using HspSetStringFn = void (*)(const char*, const char*);

using EngineCtorFn = void (*)(void*);
using EngineDtorFn = void (*)(void*);
using CreateDocumentFn = void (*)(void*);
using OpenDocumentFn = bool (*)(void*, const char*);
using SaveDocumentFn = bool (*)(void*, const char*);
using GetPageCountFn = int (*)(void*);
using FirstPageSizeFn = CGSize (*)(void*);
using PaperExtentFn = CGRect (*)(void*, int);
using SetZoomFn = void (*)(void*, unsigned int);
using DrawPageFn = bool (*)(void*, wchar_t*, tagRECT);
using HspTempSetDirFn = void (*)(const char*);

static std::string jsonEscape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 16);
    for (char c : s) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned char>(c));
                    out += buf;
                } else {
                    out += c;
                }
        }
    }
    return out;
}

static void printErrorJson(const std::string& message) {
    fprintf(stdout, "{\"success\":false,\"error\":\"%s\"}\n", jsonEscape(message).c_str());
    fflush(stdout);
}

int main(int argc, const char* argv[]) {
    signal(SIGSEGV, crashHandler);
    signal(SIGBUS, crashHandler);
    signal(SIGABRT, crashHandler);
    @autoreleasepool {
        // Parse CLI arguments
        std::string inputPath;
        std::string outputPath;
        std::string appBundlePath = "/Applications/Hancom Office HWP.app";
        std::string renderMode = "bitmap"; // "bitmap" (default: 300 DPI) or "vector"
        double scale = 300.0 / 96.0; // Default 300 DPI (print quality)
        int startPage = 1;  // 1-based inclusive
        int endPage = -1;   // 1-based inclusive (-1 = all pages)
        bool infoOnly = false;

        for (int i = 1; i < argc; ++i) {
            std::string arg = argv[i];
            if (arg == "--input" && i + 1 < argc) {
                inputPath = argv[++i];
            } else if (arg == "--output" && i + 1 < argc) {
                outputPath = argv[++i];
            } else if (arg == "--app-bundle" && i + 1 < argc) {
                appBundlePath = argv[++i];
            } else if (arg == "--mode" && i + 1 < argc) {
                renderMode = argv[++i];
            } else if (arg == "--vector") {
                renderMode = "vector";
            } else if (arg == "--bitmap") {
                renderMode = "bitmap";
            } else if (arg == "--scale" && i + 1 < argc) {
                scale = atof(argv[++i]);
                if (scale < 0.5) scale = 0.5;
                if (scale > 8.0) scale = 8.0;
            } else if (arg == "--dpi" && i + 1 < argc) {
                double dpi = atof(argv[++i]);
                if (dpi < 48.0) dpi = 48.0;
                if (dpi > 600.0) dpi = 600.0;
                scale = dpi / 96.0;
            } else if (arg == "--start-page" && i + 1 < argc) {
                startPage = atoi(argv[++i]);
            } else if (arg == "--end-page" && i + 1 < argc) {
                endPage = atoi(argv[++i]);
            } else if (arg == "--info-only") {
                infoOnly = true;
            } else if (arg == "--help" || arg == "-h") {
                fprintf(stdout,
                    "Usage: hwp2pdf_cli --input <path.hwp|path.hwpx> [--output <path.pdf>] [options]\n"
                    "Options:\n"
                    "  --input <path>       Input .hwp or .hwpx file path\n"
                    "  --output <path>      Output .pdf file path\n"
                    "  --info-only          Only inspect page count and dimensions without rendering PDF\n"
                    "  --mode <mode>        Render mode: 'bitmap' (default: 300 DPI high-res) or 'vector'\n"
                    "  --dpi <float>        Render DPI (48..600; default: 300)\n"
                    "  --scale <float>      Render scale factor (overridden by --dpi)\n"
                    "  --start-page <int>   1-based start page (default: 1)\n"
                    "  --end-page <int>     1-based end page (default: all pages)\n"
                    "  --app-bundle <path>  Path to Hancom Office HWP.app (default: /Applications/Hancom Office HWP.app)\n");
                return 0;
            }
        }

        if (inputPath.empty()) {
            printErrorJson("Missing required --input <path> argument.");
            return 1;
        }
        if (!infoOnly && outputPath.empty()) {
            printErrorJson("Missing required --output <path> argument (or pass --info-only).");
            return 1;
        }

        // Resolve absolute input path
        NSString* nsInputPath = [[NSString stringWithUTF8String:inputPath.c_str()] stringByStandardizingPath];
        if (![[NSFileManager defaultManager] fileExistsAtPath:nsInputPath]) {
            printErrorJson("Input file does not exist: " + std::string([nsInputPath UTF8String]));
            return 1;
        }
        inputPath = [nsInputPath UTF8String];

        // Register all Hancom bundled TrueType fonts with CoreText for this process
        // so that text in HWP/HWPX documents renders with sharp native vector glyphs
        // instead of falling back to blurry software bitmap rasterization.
        registerBundledFonts(appBundlePath);

        // Create a completely isolated, private temporary directory for Hancom engine
        // to prevent Hancom's HspTempClearDir() from wiping the user's macOS $TMPDIR.
        char isolatedTmpTemplate[] = "/tmp/hwp2pdf_isolated_XXXXXX";
        char* isolatedTmpPath = mkdtemp(isolatedTmpTemplate);
        std::string safeTempDir;
        if (isolatedTmpPath) {
            safeTempDir = isolatedTmpPath;
            setenv("TMPDIR", safeTempDir.c_str(), 1);
        } else {
            safeTempDir = "/tmp";
        }

        // Initialize NSApplication in accessory/prohibited activation policy so no Dock icon bounces
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];

        std::string hncDir = appBundlePath + "/Contents/Resources/Hnc";
        std::string hncBinDir = appBundlePath + "/Contents/Frameworks/Hnc/Bin";
        std::string qlFrameworksDir = appBundlePath + "/Contents/PlugIns/HwpQLExtPreview.appex/Contents/Frameworks";

        std::string foundationPath = hncBinDir + "/libHncFoundation.dylib";
        std::string hspPath = hncBinDir + "/libhsp.dylib";
        std::string hwpAppPath = hncBinDir + "/HwpApp.dylib";
        std::string simpleEnginePath = qlFrameworksDir + "/libSimpleEngineLib.dylib";

        void* hHsp = dlopen(hspPath.c_str(), RTLD_NOW | RTLD_GLOBAL);
        if (!hHsp) {
            printErrorJson(std::string("Failed to load libhsp.dylib: ") + dlerror());
            return 1;
        }

        void* hFoundation = dlopen(foundationPath.c_str(), RTLD_NOW | RTLD_GLOBAL);
        if (!hFoundation) {
            printErrorJson(std::string("Failed to load libHncFoundation.dylib: ") + dlerror());
            return 1;
        }

        void* hHwpApp = dlopen(hwpAppPath.c_str(), RTLD_NOW | RTLD_GLOBAL);
        suppressMarginCropMarks(hHwpApp);

        void* hSimple = dlopen(simpleEnginePath.c_str(), RTLD_NOW | RTLD_GLOBAL);
        if (!hSimple) {
            printErrorJson(std::string("Failed to load libSimpleEngineLib.dylib: ") + dlerror());
            return 1;
        }

        // CRITICAL FIX: Bind Hancom's temporary directory to our private isolated directory.
        // If HspTempSetDir is not called, Hancom's HspTempClearDir() defaults to NSTemporaryDirectory()
        // and recursively unlinks/wipes EVERY FILE in the user's entire system temporary folder ($TMPDIR)!
        auto hspTempSetDir = reinterpret_cast<HspTempSetDirFn>(dlsym(hHsp, "_Z13HspTempSetDirPKc"));
        if (hspTempSetDir) {
            hspTempSetDir(safeTempDir.c_str());
        }

        // Configure HNC_DIR, HNC_BIN_DIR, and LOCALE_LANG before SimpleEngine initialization
        auto setHncString = reinterpret_cast<SetStringFn>(dlsym(hFoundation, "_ZN17HncGlobalSettings9SetStringEPKcS1_"));
        auto setHspString = reinterpret_cast<HspSetStringFn>(dlsym(hHsp, "_Z26HspGlobalSettingsSetStringPKcS0_"));
        if (!setHncString || !setHspString) {
            printErrorJson("Failed to resolve HncGlobalSettings::SetString or HspGlobalSettingsSetString.");
            return 1;
        }

        setHncString("HNC_DIR", hncDir.c_str());
        setHncString("HNC_BIN_DIR", hncBinDir.c_str());
        setHspString("LOCALE_LANG", "ko_KR");

        // Resolve SimpleEngine methods
        auto engineCtor = reinterpret_cast<EngineCtorFn>(dlsym(hSimple, "_ZN12SimpleEngineC1Ev"));
        auto engineDtor = reinterpret_cast<EngineDtorFn>(dlsym(hSimple, "_ZN12SimpleEngineD1Ev"));
        auto createDocument = reinterpret_cast<CreateDocumentFn>(dlsym(hSimple, "_ZN12SimpleEngine14CreateDocumentEv"));
        auto openDocument = reinterpret_cast<OpenDocumentFn>(dlsym(hSimple, "_ZN12SimpleEngine12OpenDocumentEPKc"));
        auto saveDocument = reinterpret_cast<SaveDocumentFn>(dlsym(hSimple, "_ZN12SimpleEngine12SaveDocumentEPKc"));
        auto getPageCount = reinterpret_cast<GetPageCountFn>(dlsym(hSimple, "_ZN12SimpleEngine12GetPageCountEv"));
        auto firstPageSize = reinterpret_cast<FirstPageSizeFn>(dlsym(hSimple, "_ZN12SimpleEngine13firstPageSizeEv"));
        auto paperExtent = reinterpret_cast<PaperExtentFn>(dlsym(hSimple, "_ZN12SimpleEngine11paperExtentEi"));
        auto setZoom = reinterpret_cast<SetZoomFn>(dlsym(hSimple, "_ZN12SimpleEngine7setZoomEj"));
        auto drawPage = reinterpret_cast<DrawPageFn>(dlsym(hSimple, "_ZN12SimpleEngine8drawPageEPw7tagRECT"));

        if (!engineCtor || !engineDtor || !createDocument || !openDocument ||
            !getPageCount || !firstPageSize || !paperExtent || !setZoom || !drawPage) {
            printErrorJson("Failed to resolve one or more SimpleEngine symbols from libSimpleEngineLib.dylib.");
            return 1;
        }

        // Allocate SimpleEngine instance (sizeof(SimpleEngine) == 0xa0 = 160 bytes; allocate 256 bytes aligned)
        alignas(16) uint8_t engineStorage[256];
        memset(engineStorage, 0, sizeof(engineStorage));
        void* engine = static_cast<void*>(engineStorage);

        engineCtor(engine);
        createDocument(engine);

        bool opened = openDocument(engine, inputPath.c_str());
        if (!opened) {
            engineDtor(engine);
            printErrorJson("SimpleEngine::OpenDocument failed for file: " + inputPath);
            return 1;
        }

        int totalPages = getPageCount(engine);
        if (totalPages <= 0) {
            engineDtor(engine);
            printErrorJson("Document returned 0 pages: " + inputPath);
            return 1;
        }

        if (startPage < 1) startPage = 1;
        if (endPage < 1 || endPage > totalPages) endPage = totalPages;
        if (startPage > endPage) {
            engineDtor(engine);
            printErrorJson("Invalid page range: start_page (" + std::to_string(startPage) +
                           ") > end_page (" + std::to_string(endPage) + "), total pages = " + std::to_string(totalPages));
            return 1;
        }

        struct PageDimension {
            int pageNumber;
            double widthHwpUnit;
            double heightHwpUnit;
            double widthPt;
            double heightPt;
            double widthMm;
            double heightMm;
        };
        std::vector<PageDimension> pageDims;
        for (int idx = 0; idx < totalPages; ++idx) {
            CGRect ext = paperExtent(engine, idx);
            double wHwp = ext.size.width;
            double hHwp = ext.size.height;
            double wPt = wHwp / 100.0;
            double hPt = hHwp / 100.0;
            double wMm = wPt * 25.4 / 72.0;
            double hMm = hPt * 25.4 / 72.0;
            pageDims.push_back({idx + 1, wHwp, hHwp, wPt, hPt, wMm, hMm});
        }

        int pagesRendered = 0;
        if (!infoOnly && !outputPath.empty()) {
            NSString* nsOutputPath = [[NSString stringWithUTF8String:outputPath.c_str()] stringByStandardizingPath];
            outputPath = [nsOutputPath UTF8String];

            // Ensure parent directory exists
            NSString* parentDir = [nsOutputPath stringByDeletingLastPathComponent];
            if (parentDir.length > 0) {
                [[NSFileManager defaultManager] createDirectoryAtPath:parentDir
                                          withIntermediateDirectories:YES
                                                           attributes:nil
                                                                error:nil];
            }

            CFURLRef pdfURL = CFURLCreateFromFileSystemRepresentation(
                kCFAllocatorDefault,
                reinterpret_cast<const UInt8*>(outputPath.c_str()),
                outputPath.size(),
                false);
            if (!pdfURL) {
                engineDtor(engine);
                printErrorJson("Failed to create CFURL for output path: " + outputPath);
                return 1;
            }

            CGSize firstSizePt = firstPageSize(engine);
            CGRect defaultMediaBox = CGRectMake(0, 0, firstSizePt.width, firstSizePt.height);
            CGContextRef pdfCtx = CGPDFContextCreateWithURL(pdfURL, &defaultMediaBox, NULL);
            CFRelease(pdfURL);

            if (!pdfCtx) {
                engineDtor(engine);
                printErrorJson("Failed to create CGPDFContext at output path: " + outputPath);
                return 1;
            }

            CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();

            for (int pageNum = startPage; pageNum <= endPage; ++pageNum) {
                int pageIndex = pageNum - 1;
                CGRect ext = paperExtent(engine, pageIndex);
                double pageWidthPt = ext.size.width / 100.0;
                double pageHeightPt = ext.size.height / 100.0;
                CGRect mediaBox = CGRectMake(0, 0, pageWidthPt, pageHeightPt);

                unsigned int zoomVal = static_cast<unsigned int>(scale * 96.0);
                setZoom(engine, zoomVal);

                tagRECT rect;
                rect.left = static_cast<int32_t>(ext.origin.x);
                rect.top = static_cast<int32_t>(ext.origin.y);
                rect.right = static_cast<int32_t>(ext.origin.x + ext.size.width);
                rect.bottom = static_cast<int32_t>(ext.origin.y + ext.size.height);

                if (renderMode == "vector") {
                    setZoom(engine, 72); // 72 DPI = 1 pt per PDF user unit
                    CGContextBeginPage(pdfCtx, &mediaBox);
                    CGContextSaveGState(pdfCtx);
                    CGContextTranslateCTM(pdfCtx, 0.0, pageHeightPt);
                    CGContextScaleCTM(pdfCtx, 1.0, -1.0);
                    bool drew = drawPage(engine, reinterpret_cast<wchar_t*>(pdfCtx), rect);
                    CGContextRestoreGState(pdfCtx);
                    CGContextEndPage(pdfCtx);
                    if (!drew) {
                        CGColorSpaceRelease(colorSpace);
                        CGPDFContextClose(pdfCtx);
                        CGContextRelease(pdfCtx);
                        engineDtor(engine);
                        printErrorJson("SimpleEngine::drawPage returned false on page " + std::to_string(pageNum));
                        return 1;
                    }
                    pagesRendered++;
                } else {
                    size_t widthPx = static_cast<size_t>(ext.size.width * scale * 96.0 / 7200.0);
                    size_t heightPx = static_cast<size_t>(ext.size.height * scale * 96.0 / 7200.0);
                    if (widthPx < 1) widthPx = 1;
                    if (heightPx < 1) heightPx = 1;

                    CGContextRef bmpCtx = CGBitmapContextCreate(
                        NULL,
                        widthPx,
                        heightPx,
                        8,
                        0,
                        colorSpace,
                        kCGImageAlphaPremultipliedFirst);

                    if (!bmpCtx) {
                        CGColorSpaceRelease(colorSpace);
                        CGPDFContextClose(pdfCtx);
                        CGContextRelease(pdfCtx);
                        engineDtor(engine);
                        printErrorJson("Failed to allocate CGBitmapContext for page " + std::to_string(pageNum));
                        return 1;
                    }

                    // Fill white background
                    CGContextSetRGBFillColor(bmpCtx, 1.0, 1.0, 1.0, 1.0);
                    CGContextFillRect(bmpCtx, CGRectMake(0, 0, widthPx, heightPx));

                    // Flip coordinate system as required by SimpleEngine::drawPage
                    CGContextTranslateCTM(bmpCtx, 0.0, static_cast<CGFloat>(heightPx));
                    CGContextScaleCTM(bmpCtx, 1.0, -1.0);

                    bool drew = drawPage(engine, reinterpret_cast<wchar_t*>(bmpCtx), rect);
                    if (!drew) {
                        CGContextRelease(bmpCtx);
                        CGColorSpaceRelease(colorSpace);
                        CGPDFContextClose(pdfCtx);
                        CGContextRelease(pdfCtx);
                        engineDtor(engine);
                        printErrorJson("SimpleEngine::drawPage returned false on page " + std::to_string(pageNum));
                        return 1;
                    }

                    CGImageRef pageImage = CGBitmapContextCreateImage(bmpCtx);
                    CGContextBeginPage(pdfCtx, &mediaBox);
                    if (pageImage) {
                        CGContextDrawImage(pdfCtx, mediaBox, pageImage);
                        CGImageRelease(pageImage);
                    }
                    CGContextEndPage(pdfCtx);
                    CGContextRelease(bmpCtx);
                    pagesRendered++;
                }
            }

            CGColorSpaceRelease(colorSpace);
            CGPDFContextClose(pdfCtx);
            CGContextRelease(pdfCtx);
        }

        engineDtor(engine);

        // Emit structured JSON output
        double reportedDpi = (renderMode == "vector") ? 72.0 : (scale * 96.0);
        fprintf(stdout, "{\"success\":true,\"input_path\":\"%s\"", jsonEscape(inputPath).c_str());
        if (!outputPath.empty()) {
            fprintf(stdout, ",\"output_path\":\"%s\"", jsonEscape(outputPath).c_str());
        }
        fprintf(stdout, ",\"mode\":\"%s\",\"total_pages\":%d,\"start_page\":%d,\"end_page\":%d,\"pages_rendered\":%d,\"dpi\":%.1f,\"pages\":[",
                jsonEscape(renderMode).c_str(), totalPages, startPage, endPage, pagesRendered, reportedDpi);
        for (size_t i = 0; i < pageDims.size(); ++i) {
            const auto& p = pageDims[i];
            fprintf(stdout,
                    "%s{\"page\":%d,\"width_pt\":%.2f,\"height_pt\":%.2f,\"width_mm\":%.2f,\"height_mm\":%.2f}",
                    (i > 0 ? "," : ""), p.pageNumber, p.widthPt, p.heightPt, p.widthMm, p.heightMm);
        }
        fprintf(stdout, "]}\n");
        fflush(stdout);
        return 0;
    }
}
