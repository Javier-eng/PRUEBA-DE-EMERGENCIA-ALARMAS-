// Plugin de Vite para inyectar variables de entorno en index.html y firebase-messaging-sw.js
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function injectSwConfig() {
  const swPath = resolve(process.cwd(), 'public/firebase-messaging-sw.js');
  if (!existsSync(swPath)) return;
  
  try {
    let swContent = readFileSync(swPath, 'utf-8');
    const config = {
      apiKey: process.env.VITE_FIREBASE_API_KEY || '',
      authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || '',
      projectId: process.env.VITE_FIREBASE_PROJECT_ID || '',
      storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || '',
      messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
      appId: process.env.VITE_FIREBASE_APP_ID || '',
      measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID || '',
    };
    
    // Reemplazar el objeto de configuración hardcodeado
    swContent = swContent.replace(
      /firebase\.initializeApp\(\{[^}]*\}\);/s,
      `firebase.initializeApp(${JSON.stringify(config)});`
    );
    
    writeFileSync(swPath, swContent, 'utf-8');
  } catch (e) {
    // Silencioso en desarrollo si no hay variables
    if (process.env.NODE_ENV === 'production') {
      console.warn('No se pudo inyectar config en service worker:', e);
    }
  }
}

export default function injectEnvPlugin() {
  return {
    name: 'inject-env',
    configResolved() {
      // Inyectar en desarrollo y producción
      injectSwConfig();
    },
    buildStart() {
      // También inyectar al iniciar el build
      injectSwConfig();
    },
    transformIndexHtml(html) {
      // Inyectar variables en index.html
      return html.replace(/%VITE_FIREBASE_(\w+)%/g, (match, key) => {
        const value = process.env[`VITE_FIREBASE_${key}`] || '';
        return JSON.stringify(value).replace(/^"|"$/g, '');
      });
    },
  };
}
