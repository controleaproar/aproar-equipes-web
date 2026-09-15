import "./globals.css";
import "./system.css";

export const metadata = {
  title: "APROAR Equipes",
  description: "Gestão de equipes da APROAR Engenharia",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
