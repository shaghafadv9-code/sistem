/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}', './client/index.html', './client/src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans Arabic"', 'Tajawal', 'Cairo', 'Segoe UI', 'Tahoma', 'sans-serif']
      },
      colors: {
        brand: {
          50: '#eef6ff', 100: '#d9eaff', 200: '#bcdbff', 300: '#8ec2ff',
          400: '#59a3ff', 500: '#3380fc', 600: '#1d61f5', 700: '#164de5',
          800: '#183fbb', 900: '#193a93', 950: '#142359'
        }
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.05), 0 4px 16px -4px rgba(16,24,40,.08)',
        pop: '0 8px 32px -8px rgba(16,24,40,.22)'
      },
      borderRadius: { xl2: '1.25rem' }
    }
  },
  plugins: []
};
