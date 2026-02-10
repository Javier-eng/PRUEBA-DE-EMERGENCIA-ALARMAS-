import { StrictMode, Component, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AuthProvider } from './contexts/AuthContext'
import App from './App'
import { startConnectionMonitor } from './utils/connectionMonitor'

// ========== Consola de Errores (recuadro al final de la página, visible en Android) ==========
const ERROR_CONSOLE_ID = 'error-console'
const ERROR_CONSOLE_LOG_ID = 'error-console-log'
const MAX_CONSOLE_LINES = 200

function formatConsoleArgs(args: unknown[]): string {
  return args.map((a) => {
    if (a instanceof Error) {
      return `[Error] ${a.name}: ${a.message}${a.stack ? '\n' + a.stack : ''}`
    }
    if (typeof a === 'object' && a !== null) return JSON.stringify(a, null, 2)
    return String(a)
  }).join(' ')
}

function appendToErrorConsole(level: 'log' | 'error' | 'warn', args: unknown[]): void {
  const el = document.getElementById(ERROR_CONSOLE_LOG_ID)
  if (!el) return
  const line = document.createElement('div')
  line.style.cssText = 'padding:6px 8px;border-bottom:1px solid #eee;font-size:11px;font-family:monospace;white-space:pre-wrap;word-break:break-word;'
  const time = new Date().toLocaleTimeString()
  const text = formatConsoleArgs(args)
  line.style.color = level === 'error' ? '#b91c1c' : level === 'warn' ? '#b45309' : '#1f2937'
  line.textContent = `[${time}] [${level}] ${text}`
  el.appendChild(line)
  while (el.children.length > MAX_CONSOLE_LINES) el.removeChild(el.firstChild!)
  const wrap = document.getElementById(ERROR_CONSOLE_ID)
  if (wrap) wrap.scrollTop = wrap.scrollHeight
}

function ensureErrorConsoleInDOM(): void {
  if (document.getElementById(ERROR_CONSOLE_ID)) return
  const wrap = document.createElement('div')
  wrap.id = ERROR_CONSOLE_ID
  wrap.style.cssText = `
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    max-height: 220px;
    overflow: auto;
    background: #fff;
    border-top: 2px solid #e5e7eb;
    box-shadow: 0 -4px 6px rgba(0,0,0,0.08);
    z-index: 99998;
    font-family: system-ui, -apple-system, sans-serif;
  `
  const header = document.createElement('div')
  header.style.cssText = 'padding:8px 12px;font-weight:700;font-size:12px;background:#f3f4f6;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;'
  header.innerHTML = '<span>Consola de errores</span><button type="button" id="error-console-close" style="padding:4px 10px;font-size:11px;cursor:pointer;border-radius:6px;border:1px solid #d1d5db;background:#fff;">Ocultar</button>'
  wrap.appendChild(header)
  const log = document.createElement('div')
  log.id = ERROR_CONSOLE_LOG_ID
  wrap.appendChild(log)
  document.body.appendChild(wrap)
  document.getElementById('error-console-close')?.addEventListener('click', () => {
    wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none'
  })
}

function initErrorConsole(): void {
  if (typeof document === 'undefined') return
  const setup = () => {
    ensureErrorConsoleInDOM()
    const origLog = console.log
    const origError = console.error
    const origWarn = console.warn
    console.log = (...args: unknown[]) => {
      origLog.apply(console, args)
      appendToErrorConsole('log', args)
    }
    console.error = (...args: unknown[]) => {
      origError.apply(console, args)
      appendToErrorConsole('error', args)
    }
    console.warn = (...args: unknown[]) => {
      origWarn.apply(console, args)
      appendToErrorConsole('warn', args)
    }
    window.onerror = (message, source, lineno, colno, err) => {
      const detail = err
        ? `Tipo: ${err.name}\nMensaje: ${err.message}\n${err.stack ?? ''}`
        : `${message} (${source}:${lineno}:${colno})`
      appendToErrorConsole('error', [detail])
      return false
    }
    appendToErrorConsole('log', ['Consola activa. Los logs y errores se muestran aquí.'])
  }
  if (document.body) setup()
  else document.addEventListener('DOMContentLoaded', setup)
}

initErrorConsole()

// Monitor: si estamos offline > 10s, terminate + clearPersistence + reload para desbloquear el stream Listen
if (typeof window !== 'undefined') startConnectionMonitor()

declare global {
  interface Window {
    __appendToErrorConsole?: (level: 'log' | 'error' | 'warn', args: unknown[]) => void
    __toggleErrorConsole?: () => void
    __showSWBannerError?: (error: unknown) => void
    __clearBanner?: () => void
  }
}
if (typeof window !== 'undefined') {
  window.__appendToErrorConsole = appendToErrorConsole
  window.__toggleErrorConsole = () => {
    const w = document.getElementById(ERROR_CONSOLE_ID)
    if (w) w.style.display = w.style.display === 'none' ? 'block' : 'none'
  }
}

// Registrar Service Worker para notificaciones push — banner nunca se auto-oculta en error
const getBannerEl = () => document.getElementById('sw-status-indicator')

const clearBanner = () => {
  const el = getBannerEl()
  if (el) el.remove()
}

const showSWStatus = (message: string, isError = false) => {
  const appendStatus = () => {
    const existing = getBannerEl();
    if (existing) existing.remove();
    const statusDiv = document.createElement('div');
    statusDiv.id = 'sw-status-indicator';
    statusDiv.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: ${isError ? '#ef4444' : '#10b981'};
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      z-index: 99999;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      max-width: 90%;
      text-align: center;
      font-family: system-ui, -apple-system, sans-serif;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 70vh;
      overflow: auto;
    `;
    statusDiv.textContent = message;
    if (document.body) document.body.appendChild(statusDiv);
    else document.documentElement.appendChild(statusDiv);
    if (isError) console.error('❌ Service Worker:', message);
    else {
      console.info('✅ Service Worker:', message);
      setTimeout(clearBanner, 2000);
    }
  };
  if (document.body || document.documentElement) appendStatus();
  else document.addEventListener('DOMContentLoaded', appendStatus);
};

/** Error del Firebase Service Worker: banner + volcado en consola con tipo, mensaje y stack. */
const showSWError = (error: unknown) => {
  let text = 'Error desconocido'
  if (error instanceof Error) {
    text = `${error.name}: ${error.message}`
    if (error.stack) text += `\n\n${error.stack}`
  } else if (typeof error === 'string') text = error
  else text = JSON.stringify(error, null, 2)
  showSWStatus(`❌ ERROR\n\n${text}`, true)
  const detail =
    error instanceof Error
      ? `Firebase Service Worker\nTipo: ${error.name}\nMensaje: ${error.message}\n${error.stack ?? '(sin stack)'}`
      : String(error)
  appendToErrorConsole('error', [detail])
  console.error('❌ Service Worker / getToken:', error)
}

if (typeof window !== 'undefined') {
  window.__showSWBannerError = showSWError
  window.__clearBanner = clearBanner
}

const SW_SCRIPT = '/firebase-messaging-sw.js';
const isSecureContext = () =>
  typeof location !== 'undefined' && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');

/** Re-registra el Service Worker si no responde (navegador lo mató por ahorro de energía). No bloquear por micro-cortes de red. */
function ensureServiceWorkerAlive(): void {
  if (!('serviceWorker' in navigator) || !isSecureContext()) return;
  const controller = navigator.serviceWorker.controller;
  if (!controller || controller.state === 'redundant') {
    try {
      navigator.serviceWorker
        .register(SW_SCRIPT)
        .then(() => {
          try { console.info('[SW] Re-registro exitoso tras despertar'); } catch (_) {}
        })
        .catch((err) => {
          try { console.warn('[SW] Re-registro fallido (p. ej. micro-corte):', (err as Error)?.message); } catch (_) {}
        });
    } catch (_) {}
  }
}

if ('serviceWorker' in navigator && isSecureContext()) {
  showSWStatus('Registrando Service Worker...', false);

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    console.info('Nueva versión del Service Worker activa, recargando para cargar módulos actualizados.');
    window.location.reload();
  });

  // Keep-alive: mantener el SW activo enviando pings periódicos
  // Esto evita que Chrome suspenda el SW por ahorro de energía (soluciona fallo alterno)
  function pingServiceWorker(): void {
    if (!('serviceWorker' in navigator)) return;
    const controller = navigator.serviceWorker.controller;
    if (controller) {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        if (event.data?.type === 'KEEP_ALIVE_ACK') {
          try { console.log('[SW Keep-Alive] Ping exitoso'); } catch (_) {}
        }
      };
      try {
        controller.postMessage({ type: 'KEEP_ALIVE' }, [channel.port2]);
      } catch (err) {
        try { console.warn('[SW Keep-Alive] Error enviando ping:', (err as Error)?.message); } catch (_) {}
      }
    }
  }

  // Despertar SW al volver a la pestaña por si el navegador lo cerró
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        ensureServiceWorkerAlive();
        pingServiceWorker(); // Ping inmediato al volver a la pestaña
      }
    });
    setInterval(ensureServiceWorkerAlive, 60000);
    // Ping cada 30 segundos para mantener el SW activo (evita suspensión)
    setInterval(pingServiceWorker, 30000);
  }

  const registerWithRetry = (attempt = 0, maxAttempts = 3): void => {
    const delayMs = attempt === 0 ? 0 : 2000 * Math.min(attempt, 2);
    const doRegister = () => {
      try {
        navigator.serviceWorker
          .register(SW_SCRIPT)
          .then((registration) => {
            try {
              if (registration.waiting) {
                registration.waiting.postMessage({ type: 'SKIP_WAITING' });
              }
              if (registration.active && registration.active.state === 'activated') {
                showSWStatus('✅ Service Worker Registrado', false);
                console.info('Service Worker listo');
                return;
              }
              const sw = registration.installing || registration.waiting;
              if (sw) {
                if (sw.state === 'activating') {
                  showSWStatus('Esperando activación...', false);
                  console.log('Esperando activación...');
                }
                const onStateChange = () => {
                  if (sw.state === 'activating') {
                    showSWStatus('Esperando activación...', false);
                    console.log('Esperando activación...');
                  }
                  if (sw.state === 'activated') {
                    showSWStatus('✅ Service Worker Registrado', false);
                    console.info('Service Worker listo');
                  }
                  if (registration.waiting) {
                    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                  }
                };
                if (sw.state === 'activated') {
                  showSWStatus('✅ Service Worker Registrado', false);
                  console.info('Service Worker listo');
                } else {
                  sw.addEventListener('statechange', onStateChange);
                }
              } else {
                const checkActive = () => {
                  if (registration.active && registration.active.state === 'activated') {
                    showSWStatus('✅ Service Worker Registrado', false);
                    console.info('Service Worker listo');
                    return;
                  }
                  if (registration.active && registration.active.state === 'activating') {
                    showSWStatus('Esperando activación...', false);
                    console.log('Esperando activación...');
                  }
                  if (registration.waiting) {
                    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                  }
                  setTimeout(checkActive, 300);
                };
                checkActive();
              }
            } catch (innerErr) {
              showSWError(innerErr);
            }
          })
          .catch((err) => {
            const msg = (err as Error)?.message ?? String(err);
            const isNetwork = /failed to fetch|network|load/i.test(msg);
            if (isNetwork && attempt < maxAttempts) {
              console.warn('[SW] Error de red, reintento en', delayMs || 2000, 'ms');
              setTimeout(() => registerWithRetry(attempt + 1, maxAttempts), attempt === 0 ? 2000 : delayMs);
            } else {
              showSWError(err);
            }
          });
      } catch (outerErr) {
        showSWError(outerErr);
      }
    };
    if (delayMs > 0) setTimeout(doRegister, delayMs);
    else doRegister();
  };
  registerWithRetry();
} else {
  if (!isSecureContext() && typeof location !== 'undefined') {
    try { console.warn('⚠️ Service Worker requiere HTTPS o localhost. Protocolo actual:', location.protocol); } catch (_) {}
    showSWStatus('⚠️ Service Worker requiere HTTPS o localhost', true);
  } else {
    showSWStatus('⚠️ Service Worker no soportado', true);
  }
}

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  state = { hasError: false, error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error en la app:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'system-ui', maxWidth: '600px', margin: '0 auto' }}>
          <h1 style={{ color: '#b91c1c' }}>Algo ha fallado</h1>
          <pre style={{ background: '#fef2f2', padding: '1rem', overflow: 'auto' }}>
            {this.state.error.message}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('No se encontró el elemento #root. Revisa index.html.')
}

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
