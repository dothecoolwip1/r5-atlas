const modules = [
  ['Converter', 'Single reusable legal-land adapter backed by the authoritative offline ATS pack.'],
  ['Storage', 'Canonical saved LSD records now use a typed IndexedDB device store, with the key-value adapter retained for lightweight preferences.'],
  ['Providers', 'Network access is isolated behind provider interfaces instead of being scattered through UI code.'],
] as const;

export default function App() {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <p style={{ fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' }}>R5 Atlas</p>
      <h1>React and TypeScript migration workspace</h1>
      <p>
        Pack 2 adds the canonical device-first saved-location model while the proven field UI remains in service until React feature parity is verified.
      </p>
      <section aria-label="Architecture modules">
        {modules.map(([name, description]) => (
          <article key={name} style={{ border: '1px solid #d8e1e6', borderRadius: 12, padding: 16, marginTop: 12 }}>
            <h2 style={{ marginTop: 0 }}>{name}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
