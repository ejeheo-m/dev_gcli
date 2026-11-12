// Google Sheets In-App SplitView Content Script
// Dual-Iframe Sandbox Architecture (양쪽 모두 독립된 iframe 뷰포트로 분리하여 가로/세로 스크롤 완벽 보장)

(() => {
  // 1. iframe 내부에서 실행된 경우:
  // 최상위 윈도우가 아니면 이 분할 스크립트(토글 버튼 생성 등)는 실행하지 않음
  if (window.self !== window.top) {
    return;
  }

  let isSplit = false;
  let splitRatio = 50; // 좌측 퍼센트 (50%)
  let mainContainer = null;

  // 2. 플로팅 토글 버튼 생성 및 주입
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

  // 3. 단축키 바인딩 (Alt + S 또는 Cmd/Ctrl + Shift + S)
  window.addEventListener('keydown', (e) => {
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

  // 4. 토글 핸들러
  function toggleSplitView() {
    if (isSplit) {
      disableSplitView();
    } else {
      enableSplitView();
    }
  }

  // 5. 분할 뷰 활성화 (듀얼 iframe 방식)
  function enableSplitView() {
    if (isSplit) return;
    isSplit = true;

    const currentUrl = window.location.href;

    // 플로팅 버튼 상태 업데이트
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

    // 좌측 패널 (독립 iframe)
    const leftPane = document.createElement('div');
    leftPane.id = 'gss-left-pane';
    leftPane.className = 'gss-pane';
    leftPane.style.width = `calc(${splitRatio}% - 4px)`;

    const leftHeader = document.createElement('div');
    leftHeader.className = 'gss-pane-header';
    leftHeader.innerHTML = `
      <div class="gss-header-title">
        <svg style="width:16px;height:16px;fill:#1a73e8;" viewBox="0 0 24 24">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H5v-2h4v2zm0-4H5v-2h4v2zm0-4H5V7h4v2zm10 8h-8v-2h8v2zm0-4h-8v-2h8v2zm0-4h-8V7h8v2z"/>
        </svg>
        <span>좌측 시트 (기준 창)</span>
      </div>
      <div class="gss-header-actions">
        <button class="gss-btn-action" id="gss-left-reload-btn" title="좌측 뷰 새로고침">↻ 새로고침</button>
      </div>
    `;

    const leftIframe = document.createElement('iframe');
    leftIframe.id = 'gss-left-iframe';
    leftIframe.className = 'gss-iframe';
    leftIframe.src = currentUrl;
    leftIframe.allow = 'clipboard-read; clipboard-write';

    const leftOverlay = document.createElement('div');
    leftOverlay.className = 'gss-drag-overlay';

    leftPane.appendChild(leftHeader);
    leftPane.appendChild(leftIframe);
    leftPane.appendChild(leftOverlay);

    // 중간 리사이저
    const resizer = document.createElement('div');
    resizer.id = 'gss-resizer';
    resizer.title = '드래그하여 분할 비율 조정';

    // 우측 패널 (독립 iframe)
    const rightPane = document.createElement('div');
    rightPane.id = 'gss-right-pane';
    rightPane.className = 'gss-pane';
    rightPane.style.width = `calc(${100 - splitRatio}% - 4px)`;

    const rightHeader = document.createElement('div');
    rightHeader.className = 'gss-pane-header';
    rightHeader.innerHTML = `
      <div class="gss-header-title">
        <svg style="width:16px;height:16px;fill:#0f9d58;" viewBox="0 0 24 24">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H5v-2h4v2zm0-4H5v-2h4v2zm0-4H5V7h4v2zm10 8h-8v-2h8v2zm0-4h-8v-2h8v2zm0-4h-8V7h8v2z"/>
        </svg>
        <span>우측 시트 (비교 창)</span>
      </div>
      <div class="gss-header-actions">
        <button class="gss-btn-action" id="gss-right-reload-btn" title="우측 뷰 새로고침">↻ 새로고침</button>
        <button class="gss-btn-action gss-btn-close" id="gss-close-pane-btn" title="비교 창 닫기">✕ 닫기</button>
      </div>
    `;

    const rightIframe = document.createElement('iframe');
    rightIframe.id = 'gss-right-iframe';
    rightIframe.className = 'gss-iframe';
    rightIframe.src = currentUrl;
    rightIframe.allow = 'clipboard-read; clipboard-write';

    const rightOverlay = document.createElement('div');
    rightOverlay.className = 'gss-drag-overlay';

    rightPane.appendChild(rightHeader);
    rightPane.appendChild(rightIframe);
    rightPane.appendChild(rightOverlay);

    // DOM에 조립
    mainContainer.appendChild(leftPane);
    mainContainer.appendChild(resizer);
    mainContainer.appendChild(rightPane);
    document.body.appendChild(mainContainer);

    // 이벤트 바인딩: 새로고침 & 닫기
    leftHeader.querySelector('#gss-left-reload-btn').addEventListener('click', () => {
      leftIframe.src = leftIframe.src;
    });

    rightHeader.querySelector('#gss-right-reload-btn').addEventListener('click', () => {
      rightIframe.src = rightIframe.src;
    });

    rightHeader.querySelector('#gss-close-pane-btn').addEventListener('click', () => {
      disableSplitView();
    });

    // 리사이저 드래그 동작 설정
    setupResizer(resizer, leftPane, rightPane, [leftOverlay, rightOverlay]);
  }

  // 6. 분할 뷰 해제
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

    if (mainContainer && mainContainer.parentNode) {
      mainContainer.parentNode.removeChild(mainContainer);
    }
    mainContainer = null;
  }

  // 7. 스플리터 드래그 핸들러
  function setupResizer(resizer, leftPane, rightPane, overlays) {
    let isDragging = false;

    resizer.addEventListener('mousedown', (e) => {
      isDragging = true;
      resizer.classList.add('dragging');
      overlays.forEach(overlay => overlay.style.display = 'block');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const totalWidth = window.innerWidth;
      const mouseX = e.clientX;
      let ratio = (mouseX / totalWidth) * 100;

      // 최소 15%, 최대 85% 범위 제한
      ratio = Math.max(15, Math.min(85, ratio));
      splitRatio = ratio;

      leftPane.style.width = `calc(${ratio}% - 4px)`;
      rightPane.style.width = `calc(${100 - ratio}% - 4px)`;
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        resizer.classList.remove('dragging');
        overlays.forEach(overlay => overlay.style.display = 'none');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    });
  }

  // 초기화: 플로팅 버튼 삽입
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createFloatingButton);
  } else {
    createFloatingButton();
  }

  console.log("✅ Google Sheets In-App SplitView (Dual-Iframe Mode) initialized!");
})();
