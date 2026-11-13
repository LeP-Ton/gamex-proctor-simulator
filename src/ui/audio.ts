export class AudioFeedback {
  private context?: AudioContext;
  enabled = true;
  volume = 0.25;
  play(kind: "start" | "caught" | "false" | "end") {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      void this.context.resume();
      const ctx = this.context;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const frequency = { start: 440, caught: 700, false: 200, end: 523 }[kind];
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(
        frequency * (kind === "false" ? 0.7 : 1.35),
        ctx.currentTime + 0.12,
      );
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(
        this.volume * 0.16,
        ctx.currentTime + 0.01,
      );
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.2);
    } catch {
      /* 浏览器禁用音频时保持游戏可用。 */
    }
  }
}
