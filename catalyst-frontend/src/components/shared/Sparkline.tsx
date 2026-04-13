type SparklineProps = {
  data: number[];
  height?: number;
  strokeClassName?: string;
  label?: string;
};

function Sparkline({ data, height = 36, strokeClassName = 'stroke-primary-500', label }: SparklineProps) {
  const max = data.length ? Math.max(...data, 1) : 1;
  const min = data.length ? Math.min(...data, 0) : 0;
  const range = Math.max(1, max - min);
  const width = Math.max(1, data.length - 1);
  const points = data
    .map((value, index) => {
      const x = (index / width) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ height }}
      className="w-full"
      role="img"
      aria-label={label}
    >
      {data.length ? (
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          points={points}
          className={strokeClassName}
        />
      ) : null}
      {!data.length ? (
        <rect
          x="0"
          y="0"
          width="100"
          height="100"
          className="fill-zinc-200/40 stroke-zinc-300 dark:fill-zinc-900/40 dark:stroke-zinc-800"
        />
      ) : null}
    </svg>
  );
}

export default Sparkline;
