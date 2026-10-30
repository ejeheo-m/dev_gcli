# DWG Lite Studio for Mac

`~/dev_gcli/rea_dwg/Autodesk_AutoCAD_2027.0.1_macOS.dmg` 패키지를 **REA MCP**로 정적 분석한 결과를 바탕으로, 무거운 AutoCAD 전체 설치(2.52 GB) 없이 맥(macOS)에서 **`.dwg` / `.dxf` 도면의 글자·선·블록을 간편하게 수정하고 원하는 인쇄 범위(Plot Window)를 지정해 벡터 PDF로 출력**할 수 있도록 제작한 경량 로컬 CAD 프로그램입니다.

---

## 🚀 빠른 실행 방법

### 방법 1: 터미널에서 실행
```bash
cd /Users/ejeheo/.gemini/antigravity/scratch/dwg-lite-studio
npm start
```
실행 후 브라우저에서 **`http://127.0.0.1:4321`** 로 접속합니다.

### 방법 2: Finder에서 더블클릭 실행
- [`DWG-Lite-Studio-실행.command`](file:///Users/ejeheo/.gemini/antigravity/scratch/dwg-lite-studio/DWG-Lite-Studio-실행.command) 파일을 더블클릭하면 로컬 서버 구동과 함께 브라우저가 자동으로 열립니다.

### 방법 3: 터미널 CLI (`cli.js`)로 조회·수정·변환 실행
GUI를 띄우지 않고 터미널에서 바로 도면 조회(`inspect`), 글자/선/블록 수정(`edit`), 인쇄 범위 지정 PDF 출력(`plot`), 포맷 변환(`convert`)을 수행할 수 있습니다.
```bash
cd /Users/ejeheo/.gemini/antigravity/scratch/dwg-lite-studio

# 1. 도면 내 글자(TEXT/MTEXT) 및 블록(INSERT) 목록 조회
node cli.js inspect sample:arch-floorplan --texts --blocks

# 2. 도면 글자 치환 + 새 주석/선/블록 추가 후 수정본 DXF로 저장
node cli.js edit ./samples/건축평면도_판교R&D센터_A301.dxf \
  --replace-text "102 대회의실 (CONFERENCE ROOM)=102 AI 전략회의실 (30인)" \
  --add-text "보안구역 출입통제,5600,1800,160,A-TEXT" \
  --add-line "0,0,10000,0,A-WALL,#ffffff" \
  --add-block "BLK_WORKSTATION,8500,2800,1,1,0" \
  -o ./samples/cli_edited_floorplan.dxf

# 3. 특정 인쇄 범위(Window: xMin,yMin,xMax,yMax)만 지정해 흑백 A4 벡터 PDF로 출력
node cli.js plot ./samples/cli_edited_floorplan.dxf \
  --window "0,0,7500,8000" \
  --paper A4 \
  --orientation landscape \
  --style monochrome \
  -o ./samples/cli_window_plot.pdf
```

---

## 🛠️ 주요 기능

1. **오토캐드 `.dwg` & `.dxf` 파일 열기 / 저장**
   - `@mlightcad/libredwg-web` (GNU LibreDWG WebAssembly 엔진)을 탑재하여 AutoCAD 이진 `.dwg` 파일(R14 ~ R2018/R2022+)과 `.dxf` 파일을 직접 파싱합니다.
   - 수정한 도면은 표준 `.dxf` 또는 벡터 `.pdf`로 내보낼 수 있습니다.

2. **도면 글자 (`TEXT` / `MTEXT`) 수정 및 추가**
   - 도면 위 글자를 **더블클릭**하면 즉시 문구·높이·회전각을 수정하는 팝업이 열립니다.
   - 우측 **[글자 목록]** 탭에서 도면 내 모든 텍스트를 검색·필터링하고 클릭 한 번으로 해당 위치로 이동해 수정할 수 있습니다.
   - 좌측 도구바의 **[글자 추가 (단축키 `T`)]** 로 원하는 위치에 새 주석을 삽입할 수 있습니다.

3. **선·도형 (`LINE` / `LWPOLYLINE` / `CIRCLE` / `ARC`) 수정 및 작도**
   - 선이나 도형을 클릭하면 파란색 **그립(Grip) 핸들**이 표시되며, 끝점·정점·반지름·중심점을 드래그하여 길이와 형상을 직관적으로 수정할 수 있습니다.
   - 우측 **[속성 편집]** 패널에서 정확한 좌표(`X1, Y1, X2, Y2`), 선 길이(`Length`), 레이어, 색상, 선 굵기(`mm`), 선 종류(실선/파선/중심선)를 수치로 입력해 변경할 수 있습니다.

4. **블록 (`INSERT` / `BLOCK_RECORD`) 수정 및 블록 내부 편집 (`BEDIT`)**
   - 문(`BLK_DOOR_900`), 창문(`BLK_WINDOW_1800`), 책상(`BLK_WORKSTATION`), 기둥(`BLK_COLUMN_400`) 등 블록 객체를 선택해 위치·배율(`Scale X/Y`)·회전각을 수정할 수 있습니다.
   - 블록을 **더블클릭**하거나 **[블록 내부 도형/글자 편집 (BEDIT)]** 버튼을 누르면 블록 정의 내부로 진입하여 블록을 구성하는 선·호·글자를 직접 수정할 수 있으며, 도면 전체의 동일 블록에 즉시 일괄 반영됩니다.
   - **[블록 분해 (EXPLODE)]** 버튼으로 블록을 개별 선/글자 객체로 분해할 수도 있습니다.

5. **인쇄 범위 지정 (`Plot Window`, 단축키 `W`) 및 벡터 PDF 출력**
   - 상단 또는 좌측의 **[인쇄 범위 지정 (`W`)]** 버튼을 누른 뒤 도면 위에서 출력할 영역을 마우스로 드래그하면 주황색 점선으로 **인쇄 범위(Plot Window)** 가 설정됩니다.
   - 용지 크기(`A4`, `A3`, `A2`, `A1`), 방향(`가로/세로`), 축척(`Fit` 또는 `1:10`~`1:200`), 플롯 스타일(`흑백 Monochrome.ctb` / `그레이스케일` / `원본 컬러`)을 지원합니다.
   - **[벡터 PDF 다운로드]** 클릭 시 지정된 인쇄 범위로 정확히 클리핑되고 한글(`UniKS-UCS2-H` CIDFont) 및 벡터 선분이 보존된 표준 PDF 1.4 파일을 생성합니다.
