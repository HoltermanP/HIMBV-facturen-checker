export const metadata = {
  title: 'HIMBV — Bonnen & Facturen',
  description: 'Bonnen en facturen via OCR naar Basecone sturen en registreren.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="nl">
      <body
        style={{
          margin: 0,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          background: '#f6f7f9',
          color: '#1c1f23',
          // veilige marges op iPhone met notch
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {children}
      </body>
    </html>
  );
}
