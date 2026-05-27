import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Cloudflare R2 (S3-compatible) storage. Credentials come from env only and are
 * never logged or returned to the client. The bucket is PRIVATE — playback is
 * always via short-lived signed GET URLs minted here.
 */
@Injectable()
export class R2Service {
  private readonly log = new Logger('R2Service');
  private readonly client: S3Client | null;
  readonly bucket: string;
  private readonly signedUrlTtl: number;

  constructor(private cfg: ConfigService) {
    const endpoint = cfg.get<string>('R2_ENDPOINT');
    const accessKeyId = cfg.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = cfg.get<string>('R2_SECRET_ACCESS_KEY');
    this.bucket = cfg.get<string>('R2_BUCKET') || '';
    this.signedUrlTtl = +(cfg.get<string>('R2_SIGNED_URL_TTL_SECONDS') || 900);

    if (endpoint && accessKeyId && secretAccessKey && this.bucket) {
      this.client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
        // R2 requires path-style addressing.
        forcePathStyle: true,
      });
    } else {
      this.client = null;
      this.log.warn('R2 not configured (missing env) — turn-audio storage disabled');
    }
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /** Upload an object. Returns the stored key on success. */
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    if (!this.client) throw new Error('R2 storage is not configured');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /** Mint a short-lived signed GET URL for private playback. */
  async getSignedGetUrl(key: string): Promise<string> {
    if (!this.client) throw new Error('R2 storage is not configured');
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: this.signedUrlTtl },
    );
  }
}
