import { useState, useRef, useCallback, useEffect } from "react";

/**
 * 把浏览器 MediaRecorder 录制的 webm/ogg blob 转成 16-bit PCM WAV blob。
 */
async function audioBlobToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) {
    throw new Error("当前浏览器不支持 AudioContext，无法转码音频");
  }
  const ctx = new Ctor();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const numChannels = Math.min(audioBuffer.numberOfChannels, 2);
    const sampleRate = audioBuffer.sampleRate;
    const numSamples = audioBuffer.length;
    const blockAlign = numChannels * 2; // 16-bit = 2 bytes
    const dataSize = numSamples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeStr = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++)
        view.setUint8(offset + i, s.charCodeAt(i));
    };
    // RIFF header
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    // fmt chunk
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true); // PCM fmt chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true); // byte rate
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // bit depth
    // data chunk
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);
    // PCM samples (interleaved)
    const channels: Float32Array[] = [];
    for (let c = 0; c < numChannels; c++)
      channels.push(audioBuffer.getChannelData(c));
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      for (let c = 0; c < numChannels; c++) {
        const s = Math.max(-1, Math.min(1, channels[c][i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([buffer], { type: "audio/wav" });
  } finally {
    ctx.close();
  }
}

export function useRecording({
  onStop,
}: {
  onStop?: (blob: Blob) => Promise<void>;
}) {
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, [streamRef, mediaRecorderRef, chunksRef]);

  useEffect(() => {
    return () => cleanup();
  }, []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        const webmBlob = new Blob(chunksRef.current, {
          type: mr.mimeType || "audio/webm",
        });
        cleanup();

        const wavBlob = await audioBlobToWav(webmBlob);
        onStop?.(wavBlob);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch {
      setRecording(false);
      cleanup();
    }
  }, [mediaRecorderRef, streamRef, chunksRef, recording]);

  const stop = useCallback(() => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  }, [mediaRecorderRef, recording]);

  return { recording, start, stop };
}
