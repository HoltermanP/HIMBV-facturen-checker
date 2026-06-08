import './globals.css';

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
          // veilige marges op iPhone met notch; overige stijl staat in globals.css
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {children}
      </body>
    </html>
  );
}
