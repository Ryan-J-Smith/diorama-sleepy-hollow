// Render settings for the promo: lossless frames into a high-quality H.264.
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('png');
Config.setCodec('h264');
Config.setCrf(16);
Config.setPixelFormat('yuv420p');
