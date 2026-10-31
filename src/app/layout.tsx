import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Excel → Jira Bulk Creator',
  description: 'Bulk create Jira Cloud issues and upload local attachments from spreadsheets',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex flex-col min-h-screen">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16 items-center">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold shadow-sm">
                  J
                </div>
                <div>
                  <Link href="/" className="font-bold text-gray-900 text-lg hover:text-blue-600 transition">
                    Excel → Jira Bulk Creator
                  </Link>
                  <p className="text-xs text-gray-500">Jira Cloud Issue & Attachment Importer</p>
                </div>
              </div>
              <nav className="flex items-center space-x-1 sm:space-x-3">
                <Link
                  href="/"
                  className="px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:text-blue-600 hover:bg-gray-100 transition"
                >
                  Import Wizard
                </Link>
                <Link
                  href="/runs"
                  className="px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:text-blue-600 hover:bg-gray-100 transition"
                >
                  Run History
                </Link>
                <Link
                  href="/settings"
                  className="px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:text-blue-600 hover:bg-gray-100 transition"
                >
                  Settings
                </Link>
              </nav>
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>

        <footer className="bg-white border-t border-gray-200 py-4 text-center text-xs text-gray-500">
          Local single-user tool • Loopback only • Jira Cloud REST API v3
        </footer>
      </body>
    </html>
  );
}
