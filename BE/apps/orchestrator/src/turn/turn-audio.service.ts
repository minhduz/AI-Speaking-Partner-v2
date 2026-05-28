import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { TurnAudio } from './entities/turn-audio.entity';
import { Session } from '../session/entities/session.entity';
import { TeacherReview } from '../lesson/entities/teacher-review.entity';
import { R2Service } from '../storage/r2.service';
import { UserRole } from '../user/user-role.enum';

interface UploadOpts {
  turnIndex?: number | null;
  lessonAttemptId?: string | null;
  transcript?: string | null;
  durationMs?: number | null;
  clientTurnId?: string | null;
}

const AUDIO_EXT_BY_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

function normalizeMime(raw?: string | null): string {
  return (raw || 'audio/webm').split(';', 1)[0].trim().toLowerCase();
}

function safeObjectKeyPart(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'turn';
}

@Injectable()
export class TurnAudioService {
  constructor(
    @InjectRepository(TurnAudio) private audio: Repository<TurnAudio>,
    @InjectRepository(Session) private sessions: Repository<Session>,
    @InjectRepository(TeacherReview) private reviews: Repository<TeacherReview>,
    private r2: R2Service,
  ) {}

  /** Public-safe metadata projection (never includes object_key or URLs). */
  private toView(a: TurnAudio) {
    return {
      id: a.id,
      turn_index: a.turnIndex,
      transcript: a.transcript,
      content_type: a.contentType,
      byte_size: a.byteSize,
      duration_ms: a.durationMs,
      created_at: a.createdAt,
    };
  }

  /** Store a user turn's audio in R2 + persist metadata. */
  async recordTurnAudio(
    userId: string,
    sessionId: string,
    file: { buffer: Buffer; mimetype?: string; size?: number },
    opts: UploadOpts,
  ) {
    if (!this.r2.enabled) {
      throw new ServiceUnavailableException('Audio storage is not configured');
    }
    const session = await this.sessions.findOne({
      where: { id: sessionId, userId },
      select: ['id', 'lessonAttemptId'],
    });
    if (!session) throw new NotFoundException('Session not found');

    const contentType = normalizeMime(file.mimetype);
    const ext = AUDIO_EXT_BY_MIME[contentType];
    if (!ext) {
      throw new BadRequestException(`Unsupported audio content type: ${contentType || 'unknown'}`);
    }
    const turnRef = safeObjectKeyPart(
      opts.turnIndex != null ? String(opts.turnIndex) : opts.clientTurnId || 'turn',
    );
    const objectKey = `users/${userId}/sessions/${sessionId}/turns/${turnRef}-${randomUUID()}.${ext}`;

    await this.r2.putObject(objectKey, file.buffer, contentType);

    const row = this.audio.create({
      sessionId,
      userId,
      turnId: null,
      turnIndex: opts.turnIndex ?? null,
      // Trust the session's own attempt binding; only fall back to the hint.
      lessonAttemptId: session.lessonAttemptId ?? opts.lessonAttemptId ?? null,
      bucket: this.r2.bucket,
      objectKey,
      contentType,
      byteSize: file.size ?? file.buffer.length,
      durationMs: opts.durationMs ?? null,
      transcript: opts.transcript ?? null,
    });
    await this.audio.save(row);
    return this.toView(row);
  }

  /** Metadata for every saved user turn of an attempt (no URLs). */
  async getAudioTurnsForAttempt(lessonAttemptId: string | null, sessionId: string | null) {
    let rows: TurnAudio[] = [];
    if (lessonAttemptId) {
      rows = await this.audio.find({ where: { lessonAttemptId }, order: { createdAt: 'ASC' } });
    }
    if (rows.length === 0 && sessionId) {
      rows = await this.audio.find({ where: { sessionId }, order: { createdAt: 'ASC' } });
    }
    return rows.map((a) => this.toView(a));
  }

  /**
   * Mint a short-lived signed GET URL. Access: the owning student, an admin, or
   * a teacher assigned to a review of this audio's lesson attempt.
   */
  async getPlayUrl(requester: { id: string; role?: string }, turnAudioId: string) {
    const a = await this.audio.findOne({ where: { id: turnAudioId } });
    if (!a) throw new NotFoundException('Audio not found');

    const isOwner = a.userId === requester.id;
    const isAdmin = requester.role === UserRole.ADMIN;
    let isAssignedTeacher = false;
    if (!isOwner && !isAdmin && requester.role === UserRole.TEACHER && a.lessonAttemptId) {
      const review = await this.reviews.findOne({
        where: { lessonAttemptId: a.lessonAttemptId, assignedTo: requester.id },
      });
      isAssignedTeacher = !!review;
    }
    if (!isOwner && !isAdmin && !isAssignedTeacher) {
      throw new ForbiddenException('Not allowed to access this audio');
    }

    const url = await this.r2.getSignedGetUrl(a.objectKey);
    return { url, content_type: a.contentType, expires_in_seconds: undefined };
  }
}
