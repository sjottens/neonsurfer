/**
 * Controls:
 *  - Keyboard: ArrowLeft / ArrowRight steer, Space jumps.
 *  - On-screen buttons (touch): left, right and jump - tracked separately from
 *    the keyboard so an unrelated pointerup elsewhere can't cancel them.
 *
 * `steer` is -1 (left) .. +1 (right); holding both cancels out.
 */
export class InputManager {
  private keyLeft = false;
  private keyRight = false;
  private btnLeft = false;
  private btnRight = false;

  get steer(): number {
    const left = this.keyLeft || this.btnLeft;
    const right = this.keyRight || this.btnRight;
    return (right ? 1 : 0) - (left ? 1 : 0);
  }

  /** A steering input just started (for the swoosh sound). */
  onSteerStart: (() => void) | null = null;
  /** Jump pressed - fired once per press, never on key auto-repeat. */
  onJump: (() => void) | null = null;

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === "ArrowLeft") {
      e.preventDefault();
      if (!this.keyLeft) this.onSteerStart?.();
      this.keyLeft = true;
    } else if (e.code === "ArrowRight") {
      e.preventDefault();
      if (!this.keyRight) this.onSteerStart?.();
      this.keyRight = true;
    } else if (e.code === "Space") {
      e.preventDefault(); // also stops a focused button from being "clicked" by the space bar
      if (!e.repeat) this.onJump?.();
    }
  };
  private handleKeyUp = (e: KeyboardEvent) => {
    if (e.code === "ArrowLeft") this.keyLeft = false;
    else if (e.code === "ArrowRight") this.keyRight = false;
    else if (e.code === "Space") e.preventDefault();
  };

  /** Driven by the on-screen mobile buttons. */
  setButtonLeft(active: boolean) {
    if (active && !this.btnLeft) this.onSteerStart?.();
    this.btnLeft = active;
  }
  setButtonRight(active: boolean) {
    if (active && !this.btnRight) this.onSteerStart?.();
    this.btnRight = active;
  }
  pressJump() {
    this.onJump?.();
  }

  attach() {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.reset);
  }

  detach() {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.reset);
  }

  reset = () => {
    this.keyLeft = false;
    this.keyRight = false;
    this.btnLeft = false;
    this.btnRight = false;
  };
}
