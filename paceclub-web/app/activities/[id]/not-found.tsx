export default function MissingActivity() {
  return (
    <main>
      <h1>Activity not found.</h1>
      <p>This activity is not available in your account.</p>
      <a className="text-link" href="/activities">
        Back to your activities
      </a>
    </main>
  );
}
