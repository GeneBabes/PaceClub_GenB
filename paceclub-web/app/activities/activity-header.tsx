export default function ActivityHeader() {
  return (
    <header className="app-header">
      <a className="brand" href="/home">
        PACECLUB<span className="brand-dot">●</span>
      </a>
      <nav aria-label="Main navigation">
        <a href="/home">Home</a>
        <a href="/activities" aria-current="page">
          Activities
        </a>
        <a href="/profile">Profile</a>
      </nav>
    </header>
  );
}
