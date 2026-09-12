/**
 * Direct up/down input across keyboard, mouse, touch and the on-screen
 * mobile buttons - no gravity to fall back on, so both directions need an
 * explicit control:
 *  - Keyboard: Arrow Up / Arrow Down, exclusively (no Space/W/S aliases).
 *  - Mouse/touch on the canvas: hold in the top half of the play field to
 *    rise, the bottom half to dive - the closest touch equivalent to two
 *    arrow keys.
 *  - Dedicated on-screen buttons (left = up, right = down), for mobile -
 *    tracked separately so they don't fight the canvas tap-zone or get
 *    cancelled by an unrelated pointerup elsewhere on screen.
 *
 * `holdingUp`/`holdingDown` are the OR of all three sources.
 */
export class InputManager {
  private keyUp = false;
  private keyDown = false;
  private zoneUp = false;
  private zoneDown = false;
  private btnUp = false;
  private btnDown = false;

  get holdingUp() {
    return this.keyUp || this.zoneUp || this.btnUp;
  }
  get holdingDown() {
    return this.keyDown || this.zoneDown || this.btnDown;
  }

  onPress: (() => void) | null = null;

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === "ArrowUp") {
      e.preventDefault();
      this.keyUp = true;
      this.onPress?.();
    } else if (e.code === "ArrowDown") {
      e.preventDefault();
      this.keyDown = true;
      this.onPress?.();
    }
  };
  private handleKeyUp = (e: KeyboardEvent) => {
    if (e.code === "ArrowUp") this.keyUp = false;
    else if (e.code === "ArrowDown") this.keyDown = false;
  };

  private target: HTMLElement | null = null;

  private handlePointerDown = (e: PointerEvent) => {
    e.preventDefault();
    this.applyPointerZone(e);
    this.onPress?.();
  };
  private handlePointerMove = (e: PointerEvent) => {
    if (e.buttons === 0 && e.pointerType === "mouse") return; // only steer while actually held
    if (!this.zoneUp && !this.zoneDown) return;
    this.applyPointerZone(e);
  };
  private handlePointerUp = () => {
    this.zoneUp = false;
    this.zoneDown = false;
  };

  private applyPointerZone(e: PointerEvent) {
    if (!this.target) return;
    const rect = this.target.getBoundingClientRect();
    const relativeY = (e.clientY - rect.top) / rect.height;
    this.zoneUp = relativeY < 0.5;
    this.zoneDown = relativeY >= 0.5;
  }

  /** Driven by the on-screen mobile steering buttons. */
  setButtonUp(active: boolean) {
    this.btnUp = active;
    if (active) this.onPress?.();
  }
  setButtonDown(active: boolean) {
    this.btnDown = active;
    if (active) this.onPress?.();
  }

  attach(target: HTMLElement) {
    this.target = target;
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    target.addEventListener("pointerdown", this.handlePointerDown);
    target.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("pointercancel", this.handlePointerUp);
    window.addEventListener("blur", this.reset);
  }

  detach(target: HTMLElement) {
    this.target = null;
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    target.removeEventListener("pointerdown", this.handlePointerDown);
    target.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerup", this.handlePointerUp);
    window.removeEventListener("pointercancel", this.handlePointerUp);
    window.removeEventListener("blur", this.reset);
  }

  reset = () => {
    this.keyUp = false;
    this.keyDown = false;
    this.zoneUp = false;
    this.zoneDown = false;
    this.btnUp = false;
    this.btnDown = false;
  };
}
