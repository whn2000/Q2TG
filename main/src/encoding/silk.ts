import ffmpeg from 'fluent-ffmpeg';
import { file } from 'tmp-promise';
import fsP from 'fs/promises';
import env from '../models/env';

if (env.FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(env.FFMPEG_PATH);
}
if (env.FFPROBE_PATH) {
  ffmpeg.setFfprobePath(env.FFPROBE_PATH);
}

let silkPkg: any;
function getSilk() {
  if (!silkPkg) {
    try {
      silkPkg = require('silk-sdk');
    }
    catch (e) {
      throw new Error('silk-sdk native bindings not available on this platform/environment');
    }
  }
  return silkPkg;
}

const conventOggToPcm = (oggPath: string, tmpFilePath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    ffmpeg(oggPath)
      .outputFormat('s16le')
      .outputOptions([
        '-ar', '24000',
        '-ac', '1',
        '-acodec', 'pcm_s16le',
      ])
      .on('end', () => resolve())
      .on('error', reject)
      .save(tmpFilePath);
  });
};

const conventPcmToOgg = (pcmPath: string, savePath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    ffmpeg(pcmPath)
      .inputOption([
        '-f', 's16le',
        '-ar', '24000',
        '-ac', '1',
      ])
      .outputFormat('ogg')
      .audioCodec('libopus')
      .audioChannels(1)
      .audioFrequency(48000)
      .on('end', () => resolve())
      .on('error', reject)
      .save(savePath);
  });
};

const convertToVoiceOgg = (inputPath: string, savePath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputFormat('ogg')
      .audioCodec('libopus')
      .audioChannels(1)
      .audioFrequency(48000)
      .on('end', () => resolve())
      .on('error', reject)
      .save(savePath);
  });
};

export default {
  async encode(oggPath: string): Promise<Buffer> {
    const { path, cleanup } = await file();
    try {
      await conventOggToPcm(oggPath, path);
      const bufSilk = getSilk().encode(path, {
        tencent: true,
      });
      return bufSilk;
    }
    finally {
      await cleanup().catch(() => {});
    }
  },

  async decode(bufSilk: Buffer, outputPath: string): Promise<void> {
    const bufPcm = getSilk().decode(bufSilk);
    const { path, cleanup } = await file();
    try {
      await fsP.writeFile(path, bufPcm);
      await conventPcmToOgg(path, outputPath);
    }
    finally {
      await cleanup().catch(() => {});
    }
  },

  convertToVoiceOgg,

  isSilk(buf: Buffer): boolean {
    if (!buf || buf.length < 9) return false;
    return (
      buf.subarray(0, 9).toString().includes('#!SILK_V3') ||
      (buf.length > 10 && buf.subarray(1, 10).toString().includes('#!SILK_V3'))
    );
  },

  conventOggToPcm16000: (oggPath: string, tmpFilePath: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      ffmpeg(oggPath)
        .outputFormat('s16le')
        .outputOptions([
          '-ar', '16000',
          '-ac', '1',
          '-acodec', 'pcm_s16le',
        ])
        .on('end', () => resolve())
        .on('error', reject)
        .save(tmpFilePath);
    });
  },
};
