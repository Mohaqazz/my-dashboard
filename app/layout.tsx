import './globals.css'

export const metadata = {
  title: '5G Network Dashboard',
  description: 'Interactive 5G Network Simulation Dashboard with real Leeds city mapping',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        {/* Leaflet CSS will be loaded dynamically by the component */}
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}