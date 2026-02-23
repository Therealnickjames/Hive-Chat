export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background-tertiary">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-text-primary mb-2">
          HiveChat
        </h1>
        <p className="text-text-secondary">
          AI-native self-hostable chat platform
        </p>
        <div className="mt-6 flex gap-3 justify-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-status-online/20 text-status-online text-sm">
            <span className="w-2 h-2 rounded-full bg-status-online" />
            Web Service Online
          </span>
        </div>
      </div>
    </main>
  );
}
