# hwp-to-pdf-mcp

macOS에 설치된 **한컴오피스 한글(`Hancom Office HWP.app`)**의 내부 헤드리스 엔진(`libSimpleEngineLib.dylib`)을 REA(Reverse Engineer Anything)로 리버스 엔지니어링하여, GUI 창을 띄우지 않고 `.hwp` 및 `.hwpx` (`.hwt`, `.hwtx` 포함) 문서를 고품질 `.pdf`로 변환하는 MCP(Model Context Protocol) 서버입니다.

## 주요 특징

- **네이티브 한컴 엔진 직결 (`SimpleEngine`)**: 한컴오피스 앱 번들 내부의 `libSimpleEngineLib.dylib`, `libHncFoundation.dylib`, `libhsp.dylib`, `libHncBaseDraw.dylib`를 직접 로드하여 한컴오피스 고유의 표, 글상자, 글맵시, 세로쓰기, 수식, 페이지 레이아웃을 100% 동일하게 렌더링합니다.
- **초고해상도 비트맵(Bitmap) 300 DPI 기본 지원**: Windows 전용 레거시 서체(`HY신명조`, `HY중고딕` 등)가 쓰인 문서도 인쇄물 수준의 또렷한 화질(300 DPI 기본값)로 완벽하게 렌더링하여 글자 깨짐이나 흐림이 전혀 없습니다.
- **벡터(Vector) PDF 및 텍스트 검색 모드 지원**: `mode="vector"` 지정 시 `SimpleEngine::drawPage`에 `CGPDFContext`를 직접 전달하여 **텍스트 선택·검색이 가능한 초경량 벡터 PDF**를 페이지 수 제한 없이 생성합니다.
- **외부 파이썬 패키지 의존성 0개**: macOS 기본 `/usr/bin/python3` 표준 라이브러리만으로 동작하는 JSON-RPC 2.0 stdio MCP 서버입니다.
- **임시 폴더($TMPDIR) 보호 및 완전 격리**: 한컴 내부 라이브러리(`libhsp.dylib`의 `HspTempClearDir`)는 전용 임시 디렉터리가 설정되지 않을 경우 macOS 기본 `$TMPDIR`(`NSTemporaryDirectory()`) 안의 모든 파일을 재귀적으로 삭제하는 위험한 내부 버그가 있습니다. 본 구현은 `HspTempSetDir` 바인딩과 프로세스별 고유 임시 디렉터리 격리(Dual-barrier Isolation)를 적용하여 사용자의 기존 임시 파일이 삭제되지 않도록 완벽히 보호합니다.

## 디렉터리 구조

- [`server.py`](file:///Users/ejeheo/.gemini/antigravity/scratch/hwp-to-pdf-mcp/server.py): MCP JSON-RPC 2.0 stdio 서버 (`convert_hwp_to_pdf`, `batch_convert_hwp_to_pdf`, `get_hwp_document_info` 도구 제공)
- [`src/hwp2pdf_cli.mm`](file:///Users/ejeheo/.gemini/antigravity/scratch/hwp-to-pdf-mcp/src/hwp2pdf_cli.mm): `libSimpleEngineLib.dylib`의 C++ `SimpleEngine` ABI를 호출하는 네이티브 Objective-C++ CLI 바이너리 소스
- [`bin/hwp2pdf_cli`](file:///Users/ejeheo/.gemini/antigravity/scratch/hwp-to-pdf-mcp/bin/hwp2pdf_cli): 컴파일된 네이티브 실행 파일
- [`Makefile`](file:///Users/ejeheo/.gemini/antigravity/scratch/hwp-to-pdf-mcp/Makefile): 빌드 및 테스트 자동화 스크립트
- [`tests/test_mcp_server.py`](file:///Users/ejeheo/.gemini/antigravity/scratch/hwp-to-pdf-mcp/tests/test_mcp_server.py): MCP 서버 End-to-End 검증 테스트

## MCP 서버 설정 방법

Claude Desktop, Cursor, Antigravity 등의 MCP 설정 파일(`mcp_config.json` 또는 `claude_desktop_config.json`)에 아래와 같이 등록합니다:

```json
{
  "mcpServers": {
    "hwp-to-pdf": {
      "command": "/usr/bin/python3",
      "args": [
        "/Users/ejeheo/.gemini/antigravity/scratch/hwp-to-pdf-mcp/server.py"
      ]
    }
  }
}
```

## 제공되는 MCP Tools

1. **`convert_hwp_to_pdf`**
   - 단일 `.hwp` / `.hwpx` 파일을 `.pdf`로 변환합니다.
   - 인자:
     - `input_path` (필수): 원본 `.hwp` 또는 `.hwpx` 파일 경로
     - `output_path` (선택): 저장할 `.pdf` 경로 (생략 시 원본과 같은 폴더에 `.pdf`로 생성)
     - `mode` (선택): `"bitmap"` (기본값, 300 DPI 초고해상도 인쇄 품질) 또는 `"vector"` (텍스트 검색 가능 벡터 PDF)
     - `dpi` (선택): `bitmap` 모드 시 해상도 (기본값 `300`)
     - `start_page` / `end_page` (선택): 변환할 시작/끝 페이지 번호 (1-based)
2. **`batch_convert_hwp_to_pdf`**
   - 여러 개의 `.hwp` / `.hwpx` 파일 목록(`input_paths`) 또는 특정 폴더(`directory`, `recursive` 옵션 지원) 내의 문서를 일괄 변환합니다.
3. **`get_hwp_document_info`**
   - PDF 렌더링 없이 `.hwp` / `.hwpx` 문서의 총 페이지 수와 각 페이지 크기(`pt`, `mm`) 정보를 빠르게 조회합니다.
