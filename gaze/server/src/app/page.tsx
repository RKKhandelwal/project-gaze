export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem" }}>
      <h1>Gaze Server</h1>
      <p>API endpoints:</p>
      <ul>
        <li>POST /api/status</li>
        <li>GET /api/courts</li>
        <li>GET /api/courts/[courtId]/history</li>
        <li>GET /api/courts/[courtId]/predictions</li>
        <li>GET /api/courts/[courtId]/daylight</li>
      </ul>
    </main>
  );
}
