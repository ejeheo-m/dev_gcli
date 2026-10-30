// Google Sheets In-App SplitView Content Script

(() => {
  // iframe 내부에서는 재실행되지 않도록 방지
  if (window.self !== window.top) {
    return;
  }

  let isSplit = false;
  let splitRatio = 50; // 좌측 퍼센트 (50%)
  let mainContainer = null;
  let originalBodyChildren = [];

  // 1. 플로팅 토글 버튼 생성 및 주입
  function createFloatingButton() {
    if (document.getElementById('gss-toggle-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'gss-toggle-btn';
    btn.title = '단축키: Alt + S 또는 Cmd/Ctrl + Shift + S';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M3 3h18v18H3V3zm8 16V5H5v14h6zm8-14h-6v14h6V5z"/>
      </svg>
      <span>시트 분할 비교 (Split)</span>
    `;

    btn.addEventListener('click', toggleSplitView);
    document.body.appendChild(btn);
  }

  // 2. 단축키 바인딩 (Alt + S 또는 Cmd/Ctrl + Shift + S)
  window.addEventListener('keydown', (e) => {
    // 텍스트 인풋 포커스 상태에서는 입력 방해 방지
    const tag = e.target.tagName ? e.target.tagName.toLowerCase() : '';
    const isEditing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

    if ((e.altKey && e.code === 'KeyS') || ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyS')) {
      if (!isEditing || e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        toggleSplitView();
      }
    }
  }, true);

  // 3. 토글 핸들러
  function toggleSplitView() {
    if (isSplit) {
      disableSplitView();
    } else {
      enableSplitView();
    }
  }

  // 4. 분할 뷰 활성화
  function enableSplitView() {
    if (isSplit) return;
    isSplit = true;

    const btn = document.getElementById('gss-toggle-btn');
    if (btn) {
      btn.innerHTML = `
        <svg viewBox="0 0 24 24">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
        <span>단일 뷰 복귀</span>
      `;
      btn.style.background = '#d93025';
    }

    // 메인 컨테이너 생성
    mainContainer = document.createElement('div');
    mainContainer.id = 'gss-main-container';

    // 좌측 원본 컨테이너
    const leftPane = document.createElement('div');
    leftPane.id = 'gss-left-pane';
    leftPane.style.width = `calc(${splitRatio}% - 4px)`;

    // 중간 리사이저
    const resizer = document.createElement('div');
    resizer.id = 'gss-resizer';
    resizer.title = '드래그하여 분할 비율 조정';

    // 우측 패널 (iframe 및 헤더)
    const rightPane = document.createElement('div');
    rightPane.id = 'gss-right-pane';
    rightPane.style.width = `calc(${100 - splitRatio}% - 4px)`;

    // 우측 상단 툴바
    const rightHeader = document.createElement('div');
    rightHeader.id = 'gss-right-header';
    rightHeader.innerHTML = `
      <div class="gss-header-title">
        <svg style="width:16px;height:16px;fill:#0f9d58;" viewBox="0 0 24 24">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H5v-2h4v2zm0-4H5v-2h4v2zm0-4H5V7h4v2zm10 8h-8v-2h8v2zm0-4h-8v-2h8v2zm0-4h-8V7h8v2z"/>
        </svg>
        <span>비교 창 (동일 파일 동기화)</span>
      </div>
      <div class="gss-header-actions">
        <button class="gss-btn-action" id="gss-reload-btn" title="우측 뷰 새로고침">↻ 새로고침</button>
        <button class="gss-btn-action gss-btn-close" id="gss-close-pane-btn" title="비교 창 닫기">✕ 닫기</button>
      </div>
    `;

    // 우측 iframe
    const iframe = document.createElement('iframe');
    iframe.id = 'gss-iframe';
    iframe.src = window.location.href; // 현재 구글 시트 URL 동일하게 열기
    iframe.allow = 'clipboard-read; clipboard-write';

    // 드래그 중 마우스 이탈 방지용 투명 오버레이
    const dragOverlay = document.createElement('div');
    dragOverlay.id = 'gss-drag-overlay';

    rightPane.appendChild(rightHeader);
    rightPane.appendChild(iframe);
    rightPane.appendChild(dragOverlay);

    // 기존 body의 모든 자식 요소(구글 시트 렌더링 돔)를 leftPane으로 이동
    originalBodyChildren = [];
    while (document.body.firstChild) {
      const child = document.body.firstChild;
      if (child.id === 'gss-toggle-btn') {
        // 토글 버튼은 분리
        document.body.removeChild(child);
      } else {
        originalBodyChildren.push(child);
        leftPane.appendChild(child);
      }
    }

    mainContainer.appendChild(leftPane);
    mainContainer.appendChild(resizer);
    mainContainer.appendChild(rightPane);
    document.body.appendChild(mainContainer);

    // 토글 버튼 다시 바깥에 배치
    if (btn) document.body.appendChild(btn);

    // 리사이즈 이벤트 바인딩
    setupResizer(resizer, leftPane, rightPane, dragOverlay);

    // 우측 툴바 이벤트 바인딩
    rightHeader.querySelector('#gss-reload-btn').addEventListener('click', () => {
      iframe.src = iframe.src;
    });
    rightHeader.querySelector('#gss-close-pane-btn').addEventListener('click', () => {
      disableSplitView();
    });

    // 구글 시트 렌더러에 창 크기 변경 통보
    triggerSheetResize();
  }

  // 5. 분할 뷰 해제
  function disableSplitView() {
    if (!isSplit) return;
    isSplit = false;

    const btn = document.getElementById('gss-toggle-btn');
    if (btn) {
      btn.innerHTML = `
        <svg viewBox="0 0 24 24">
          <path d="M3 3h18v18H3V3zm8 16V5H5v14h6zm8-14h-6v14h6V5z"/>
        </svg>
        <span>시트 분할 비교 (Split)</span>
      `;
      btn.style.background = '#1a73e8';
    }

    const leftPane = document.getElementById('gss-left-pane');
    if (leftPane) {
      // leftPane에 있던 요소들을 다시 body로 원복
      while (leftPane.firstChild) {
        document.body.appendChild(leftPane.firstChild);
      }
    }

    if (mainContainer && mainContainer.parentNode) {
      mainContainer.parentNode.removeChild(mainContainer);
    }
    mainContainer = null;

    if (btn) document.body.appendChild(btn);

    // 원복 후 구글 시트 리사이즈 통보
    triggerSheetResize();
  }

  // 6. 스플리터 드래그 로직
  function setupResizer(resizer, leftPane, rightPane, dragOverlay) {
    let isDragging = false;

    resizer.addEventListener('mousedown', (e) => {
      isDragging = true;
      resizer.classList.add('dragging');
      dragOverlay.style.display = 'block';
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const totalWidth = window.innerWidth;
      const mouseX = e.clientX;
      let ratio = (mouseX / totalWidth) * 100;

      // 최소 20%, 최대 80% 범위 제한
      ratio = Math.max(20, Math.min(80, ratio));
      splitRatio = ratio;

      leftPane.style.width = `calc(${ratio}% - 4px)`;
      rightPane.style.width = `calc(${100 - ratio}% - 4px)`;
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        resizer.classList.remove('dragging');
        dragOverlay.style.display = 'none';
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        triggerSheetResize();
      }
    });
  }

  // 7. 구글 시트에 리사이즈 이벤트 트리거
  function triggerSheetResize() {
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 300);
  }

  // 초기 로드 시 버튼 생성
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createFloatingButton);
  } else {
    createFloatingButton();
  }

  console.log("✅ Google Sheets In-App SplitView initialized!");
})();
