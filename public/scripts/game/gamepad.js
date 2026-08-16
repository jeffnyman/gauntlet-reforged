Game.Gamepad = {
  // standard gamepad mapping (https://w3c.github.io/gamepad/#remapping) button indices
  BUTTON: {
    A: 0,
    B: 1,
    X: 2,
    Y: 3,
    LB: 4,
    RB: 5,
    LT: 6,
    RT: 7,
    SELECT: 8,
    START: 9,
    LS: 10,
    RS: 11,
    DPAD_UP: 12,
    DPAD_DOWN: 13,
    DPAD_LEFT: 14,
    DPAD_RIGHT: 15,
    HOME: 16,
  },

  DEADZONE: 0.25, // ignore small analog stick drift around center

  // mirrors Game.Key.map(map, context)'s declarative, state-gated, first-match-wins design, but
  // polling-driven: there's no native "gamepad button changed" event, so Game.Runner calls poll()
  // once per animation frame instead of this module registering DOM listeners itself
  map: function (map, context) {
    this.cfg = map || [];
    this.context = context;
    this.buttons = {}; // { [padIndex]: [pressed, pressed, ...] } — last-known button state, for edge detection
    this.dirs = {}; // { [padIndex]: {up,down,left,right} }    — last-known combined d-pad/stick direction
  },

  poll: function () {
    if (!navigator.getGamepads) return;
    var pads = navigator.getGamepads(),
      n,
      max,
      pad;
    for (n = 0, max = pads.length; n < max; n++) {
      pad = pads[n];
      if (pad) {
        this.pollButtons(pad, n);
        this.pollDirection(pad, n);
      }
    }
  },

  // edge-detects button down/up transitions against last-known state, dispatches through fire()
  pollButtons: function (pad, index) {
    var prev = this.buttons[index] || (this.buttons[index] = []),
      b,
      max,
      was,
      is;
    for (b = 0, max = pad.buttons.length; b < max; b++) {
      is = pad.buttons[b].pressed || pad.buttons[b].value > 0.5; // .value fallback for older/non-boolean implementations
      was = prev[b] || false;
      if (is && !was) this.fire(index, b, "down");
      else if (!is && was) this.fire(index, b, "up");
      prev[b] = is;
    }
  },

  // combines the d-pad and deadzone-filtered left stick into one up/down/left/right signal, and
  // calls the SAME moveUp/moveDown/moveLeft/moveRight(bool) methods keyboard input already uses —
  // no new Player API needed. Movement is continuous/composite (2D analog + 4 digital buttons all
  // feeding one signal), so it's handled here directly rather than through the declarative cfg
  // array fire()/match() uses for discrete button actions.
  pollDirection: function (pad, index) {
    var prev =
        this.dirs[index] ||
        (this.dirs[index] = {
          up: false,
          down: false,
          left: false,
          right: false,
        }),
      lx = pad.axes[0] || 0,
      ly = pad.axes[1] || 0,
      dz = this.DEADZONE,
      dpad = pad.buttons,
      up =
        (dpad[this.BUTTON.DPAD_UP] && dpad[this.BUTTON.DPAD_UP].pressed) ||
        ly < -dz,
      down =
        (dpad[this.BUTTON.DPAD_DOWN] && dpad[this.BUTTON.DPAD_DOWN].pressed) ||
        ly > dz,
      left =
        (dpad[this.BUTTON.DPAD_LEFT] && dpad[this.BUTTON.DPAD_LEFT].pressed) ||
        lx < -dz,
      right =
        (dpad[this.BUTTON.DPAD_RIGHT] &&
          dpad[this.BUTTON.DPAD_RIGHT].pressed) ||
        lx > dz,
      player =
        this.context &&
        this.context.controllers &&
        this.context.controllers.gamepads[index];

    if (player) {
      if (up !== prev.up) player.moveUp(up);
      if (down !== prev.down) player.moveDown(down);
      if (left !== prev.left) player.moveLeft(left);
      if (right !== prev.right) player.moveRight(right);
    }

    prev.up = up;
    prev.down = down;
    prev.left = left;
    prev.right = right;
  },

  fire: function (index, button, mode) {
    var n, max, k;
    for (n = 0, max = this.cfg.length; n < max; n++) {
      k = this.cfg[n];
      if (this.match(k, button, mode)) {
        k.action.call(this.context, index);
        return;
      }
    }
  },

  // mirrors Game.Key.match's exact state-gating logic (single state, or membership in an array of states)
  match: function (k, button, mode) {
    if (k.mode === mode) {
      if (
        !k.state ||
        !this.context ||
        k.state === this.context.current ||
        (is.array(k.state) && k.state.indexOf(this.context.current) >= 0)
      ) {
        if (k.button === button) return true;
      }
    }
    return false;
  },
};
