/**
 * A quiet road receding to the horizon, sitting behind everything.
 *
 * Pure geometry rather than an image: the lane dashes are trapezoids whose
 * width and length shrink as they approach the vanishing point, so it reads as
 * a real road instead of a dashed line. The whole thing is masked to fade out
 * before it reaches the content.
 */

const VIEW_W = 400;
const VIEW_H = 900;
const HORIZON_Y = 340;
const VANISH_X = 200;

/**
 * The road is wider than the frame at the bottom, so its verges sweep out
 * through the left and right edges — which is the part that stays visible in
 * the page's side margins once the cards cover the middle.
 */
const NEAR_HALF_WIDTH = 340;
const FAR_HALF_WIDTH = 20;

/** 0 at the bottom of the frame, 1 at the horizon. */
function depthAt(y: number) {
  return (VIEW_H - y) / (VIEW_H - HORIZON_Y);
}

function lerp(near: number, far: number, t: number) {
  return near + (far - near) * t;
}

/** Half-width of the road surface at a given screen height. */
function roadHalfWidth(y: number) {
  return lerp(NEAR_HALF_WIDTH, FAR_HALF_WIDTH, depthAt(y));
}

function dashHalfWidth(y: number) {
  return roadHalfWidth(y) * 0.016;
}

function dashLength(y: number) {
  return lerp(58, 7, depthAt(y));
}

/** Walks up the road laying dashes, each shorter and narrower than the last. */
function laneDashes() {
  const dashes: string[] = [];
  let near = VIEW_H - 20;

  while (near > HORIZON_Y + 25) {
    const far = near - dashLength(near);
    const nearHalf = dashHalfWidth(near);
    const farHalf = dashHalfWidth(far);

    dashes.push(
      [
        `${VANISH_X - nearHalf},${near}`,
        `${VANISH_X + nearHalf},${near}`,
        `${VANISH_X + farHalf},${far}`,
        `${VANISH_X - farHalf},${far}`,
      ].join(" "),
    );

    // Gap scales with the dash, so spacing compresses into the distance too.
    near = far - dashLength(far) * 0.95;
  }

  return dashes;
}

export function RoadBackdrop() {
  const dashes = laneDashes();

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      {/* "meet" keeps the road the same shape at every viewport width — with
          "slice" a wide desktop window scales it up several times over and a
          single lane dash ends up filling the screen. Overflow is visible so
          the verges can still run past the frame into the page margins. */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMax meet"
        className="h-full w-full overflow-visible"
      >
        <defs>
          {/* Dissolve everything as it nears the horizon. */}
          <linearGradient id="road-fade" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#fff" stopOpacity="1" />
            <stop offset="55%" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id="road-mask" maskUnits="userSpaceOnUse">
            <rect
              x="0"
              y={HORIZON_Y - 40}
              width={VIEW_W}
              height={VIEW_H - HORIZON_Y + 40}
              fill="url(#road-fade)"
            />
          </mask>
        </defs>

        {/* Warmth on the horizon, as if driving toward late afternoon. */}
        <ellipse
          cx={VANISH_X}
          cy={HORIZON_Y}
          rx="190"
          ry="70"
          fill="var(--color-tangerine)"
          opacity="0.07"
        />

        <g mask="url(#road-mask)">
          {/* Asphalt. */}
          <polygon
            points={`${VANISH_X - NEAR_HALF_WIDTH},${VIEW_H} ${VANISH_X - FAR_HALF_WIDTH},${HORIZON_Y} ${VANISH_X + FAR_HALF_WIDTH},${HORIZON_Y} ${VANISH_X + NEAR_HALF_WIDTH},${VIEW_H}`}
            fill="var(--color-navy)"
            opacity="0.09"
          />

          {/* Verges — the lines that sweep through the page margins. */}
          <polygon
            points={`${VANISH_X - NEAR_HALF_WIDTH - 6},${VIEW_H} ${VANISH_X - NEAR_HALF_WIDTH + 6},${VIEW_H} ${VANISH_X - FAR_HALF_WIDTH + 1.5},${HORIZON_Y} ${VANISH_X - FAR_HALF_WIDTH - 1.5},${HORIZON_Y}`}
            fill="var(--color-navy)"
            opacity="0.24"
          />
          <polygon
            points={`${VANISH_X + NEAR_HALF_WIDTH - 6},${VIEW_H} ${VANISH_X + NEAR_HALF_WIDTH + 6},${VIEW_H} ${VANISH_X + FAR_HALF_WIDTH + 1.5},${HORIZON_Y} ${VANISH_X + FAR_HALF_WIDTH - 1.5},${HORIZON_Y}`}
            fill="var(--color-navy)"
            opacity="0.24"
          />

          {/* The lane the app is about. */}
          {dashes.map((points) => (
            <polygon
              key={points}
              points={points}
              fill="var(--color-tangerine)"
              opacity="0.3"
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
