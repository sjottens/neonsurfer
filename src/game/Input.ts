/**
 * Direct up/down input across keyboard, mouse and touch - no gravity to
 * fall back on, so both directions need an explicit control:
 *  - Keyboard: Arrow Up / Arrow Down, exclusively (no Space/W/S aliases).
 *  - Mouse/touch: hold in the top half of the play field to rise, the
 *    bottom half to dive - the closest touch equivalent to two arrow keys.
 */
export class InputManager {
  holdingUp = false;
  holdingDown = false;
  onPress: (() => void) | null = null;

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === "ArrowUp") {
      e.preventDefault();
      this.holdingUp = true;
      this.onPress?.();
    } else if (e.code === "ArrowDown") {
      e.preventDefault();
      this.holdingDown = true;
      this.onPress?.();
    }
  };
  private handleKeyUp = (e: KeyboardEvent) => {
    if (e.code === "ArrowUp") this.holdingUp = false;
    else if (e.code === "ArrowDown") this.holdingDown = false;
  };

  private target: HTMLElement | null = null;

  private handlePointerDown = (e: PointerEvent) => {
    e.preventDefault();
    this.applyPointerZone(e);
    this.onPress?.();
  };
  private handlePointerMove = (e: PointerEvent) => {
    if (e.buttons === 0 && e.pointerType === "mouse") return; // only steer while actually held
    if (!this.holdingUp && !this.holdingDown) return;
    this.applyPointerZone(e);
  };
  private handlePointerUp = () => {
    this.holdingUp = false;
    this.holdingDown = false;
  };

  private applyPointerZone(e: PointerEvent) {
    if (!this.target) return;
    const rect = this.target.getBoundingClientRect();
    const relativeY = (e.clientY - rect.top) / rect.height;
    this.holdingUp = relativeY < 0.5;
    this.holdingDown = relativeY >= 0.5;
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
    this.holdingUp = false;
    this.holdingDown = false;
  };
}
