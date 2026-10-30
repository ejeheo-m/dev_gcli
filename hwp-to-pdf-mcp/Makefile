CXX := clang++
CXXFLAGS := -std=c++17 -O2 -fobjc-arc
FRAMEWORKS := -framework Foundation -framework AppKit -framework CoreGraphics -framework CoreText
RPATHS := \
	-Wl,-rpath,"/Applications/Hancom Office HWP.app/Contents/Frameworks/Hnc/Bin" \
	-Wl,-rpath,"/Applications/Hancom Office HWP.app/Contents/PlugIns/HwpQLExtPreview.appex/Contents/Frameworks" \
	-Wl,-rpath,"/Applications/Hancom Office HWP.app/Contents/Frameworks"

BIN := bin/hwp2pdf_cli
SRC := src/hwp2pdf_cli.mm

.PHONY: all clean test

all: $(BIN)

$(BIN): $(SRC)
	@mkdir -p bin
	$(CXX) $(CXXFLAGS) $(FRAMEWORKS) $(RPATHS) $(SRC) -o $(BIN)

test: $(BIN)
	/usr/bin/python3 tests/test_tmpdir_isolation.py
	/usr/bin/python3 tests/test_mcp_server.py

clean:
	rm -rf bin/hwp2pdf_cli tests/*.pdf
