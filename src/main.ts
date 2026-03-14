import { App } from './App';

// Always start at the top on page load/refresh
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
window.scrollTo(0, 0);

const app = new App();
app.init().catch(console.error);
