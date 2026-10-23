/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts}'],
  corePlugins: {
    // 保留现有手写 CSS 的全局样式；Tailwind 只提供新 UI 的 utilities/components。
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        mcd: {
          red: '#d92b1f',
          deep: '#a81e17',
          gold: '#ffc533',
          cream: '#fff4dc',
          ink: '#41230f',
        },
      },
      boxShadow: {
        panel: '0 12px 35px rgba(126, 67, 18, 0.14)',
        'red-glow': '0 8px 20px rgba(217, 43, 31, 0.28)',
      },
    },
  },
  plugins: [],
};
