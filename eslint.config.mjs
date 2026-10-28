// Configuración de ESLint: revisa el código buscando errores y malas prácticas.
// Se ejecuta con: npm run lint
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // Carpetas que no se revisan
  { ignores: ['**/node_modules/**', '**/dist/**'] },

  // Reglas recomendadas para JavaScript y TypeScript
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Web (React, corre en el navegador)
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Reglas nuevas del "React Compiler". El código actual funciona, pero React
      // recomienda escribir estas partes de otra forma. Quedan como advertencia
      // hasta corregirlas con calma y probarlas con dos dispositivos.
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Servidor, scripts y archivos de configuración (corren en Node)
  {
    files: ['apps/server/**/*.ts', 'scripts/**/*.mjs', 'apps/web/vite.config.ts', '*.mjs'],
    languageOptions: { globals: globals.node },
  },

  // Siempre al final: apaga las reglas de formato, de eso se encarga Prettier
  prettier,
);
