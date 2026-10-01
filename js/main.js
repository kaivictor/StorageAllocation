/* ============================================================
 * 明/暗主题：切换 html.dark 类并持久化；按钮文字反映当前主题
 * ============================================================ */
const THEME_KEY = 'storage-allocation:theme';
const themeBtn = $('#btn-theme');
function applyTheme(t) {
  document.documentElement.classList.toggle('dark', t === 'dark');
  if (themeBtn) themeBtn.textContent = (t === 'dark') ? '暗' : '明';
  try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
}
(function initTheme() {
  let t = 'light';
  try { t = localStorage.getItem(THEME_KEY) || 'light'; } catch (e) {}
  applyTheme(t);
  if (themeBtn) themeBtn.addEventListener('click', () => {
    applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
  });
})();

/* ============================================================
 * 启动
 * ============================================================ */
loadState();
initEvents();
render();

