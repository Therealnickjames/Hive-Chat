"use client";

interface ChannelHeaderProps {
  channelName: string;
  topic?: string | null;
}

export function ChannelHeader({ channelName, topic }: ChannelHeaderProps) {
  return (
    <div className="flex h-12 items-center border-b border-background-tertiary px-4">
      <div className="flex items-center gap-2">
        <span className="text-xl text-text-muted">#</span>
        <h1 className="text-base font-bold text-text-primary">
          {channelName}
        </h1>
        {topic && (
          <>
            <div className="mx-2 h-5 w-px bg-background-tertiary" />
            <span className="truncate text-sm text-text-muted">{topic}</span>
          </>
        )}
      </div>
    </div>
  );
}
