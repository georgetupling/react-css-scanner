import type { ScanProgressEvent } from "../project/index.js";
import type { CliArgs } from "./types.js";

export type CliProgressRenderer = {
  onProgress?: (event: ScanProgressEvent) => void;
  stop: () => void;
};

export function shouldUseColor(stream: NodeJS.WriteStream): boolean {
  return Boolean(stream.isTTY && !process.env.NO_COLOR);
}

export function shouldShowProgress(args: CliArgs): boolean {
  return Boolean(!args.json && process.stderr.isTTY);
}

export function createCliProgressRenderer(input: {
  enabled: boolean;
  stream: NodeJS.WriteStream;
  useColor: boolean;
}): CliProgressRenderer {
  if (!input.enabled) {
    return {
      stop() {},
    };
  }

  const frames = ["-", "\\", "|", "/"];
  let frameIndex = 0;
  let activeMessage: string | undefined;
  let timer: NodeJS.Timeout | undefined;

  const clearLine = () => {
    input.stream.write("\r\u001b[2K");
  };
  const render = () => {
    if (!activeMessage) {
      return;
    }

    const frame = frames[frameIndex % frames.length];
    frameIndex += 1;
    const marker = input.useColor ? `\u001b[36m${frame}\u001b[0m` : frame;
    clearLine();
    input.stream.write(`${marker} ${activeMessage}`);
  };
  const startTimer = () => {
    if (timer) {
      return;
    }

    timer = setInterval(render, 120);
    timer.unref();
  };

  return {
    onProgress(event) {
      if (event.status === "completed") {
        if (activeMessage === event.message) {
          activeMessage = undefined;
          clearLine();
        }
        return;
      }

      activeMessage = event.message;
      render();
      startTimer();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      activeMessage = undefined;
      clearLine();
    },
  };
}
