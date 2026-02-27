export default function WelcomePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-brand/20">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            className="text-brand"
          >
            <path
              d="M2.3 7.7L11.3 2.2C11.7 2 12.3 2 12.7 2.2L21.7 7.7C22.1 7.9 22.1 8.5 21.7 8.7L12.7 14.2C12.3 14.4 11.7 14.4 11.3 14.2L2.3 8.7C1.9 8.5 1.9 7.9 2.3 7.7Z"
              fill="currentColor"
            />
            <path
              d="M2.3 11.7L11.3 17.2C11.7 17.4 12.3 17.4 12.7 17.2L21.7 11.7"
              strokeWidth="2"
              stroke="currentColor"
            />
            <path
              d="M2.3 15.7L11.3 21.2C11.7 21.4 12.3 21.4 12.7 21.2L21.7 15.7"
              strokeWidth="2"
              stroke="currentColor"
            />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-text-primary">
          Welcome to HiveChat
        </h1>
        <p className="mt-2 max-w-md text-text-secondary">
          Select a server from the sidebar to get started, or create a new one
          to begin chatting.
        </p>
      </div>
    </div>
  );
}
