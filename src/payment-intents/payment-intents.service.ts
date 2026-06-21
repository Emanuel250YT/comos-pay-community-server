import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Asset,
  Horizon,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import QRCode from 'qrcode';
import { AppConfig } from '../config/configuration';
import { GatewayConsumer } from '../common/interfaces/gateway-consumer.interface';
import { PrismaService } from '../prisma/prisma.service';
import type { PaymentIntent } from '../../generated/prisma/client';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { QueryPaymentIntentsDto } from './dto/query-payment-intents.dto';
import { UpdatePaymentIntentDto } from './dto/update-payment-intent.dto';

// A stored intent plus its (derived) QR code — what API responses return.
export type PaymentIntentView = PaymentIntent & { qr: string };

@Injectable()
export class PaymentIntentsService {
  private readonly logger = new Logger(PaymentIntentsService.name);
  private readonly server: Horizon.Server;
  private readonly networkPassphrase: string;

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
  ) {
    const stellar = this.config.get('stellar', { infer: true });
    this.server = new Horizon.Server(stellar.horizonUrl);
    this.networkPassphrase =
      stellar.network === 'public' ? Networks.PUBLIC : Networks.TESTNET;
  }

  /**
   * Ensures a local Consumer row mirrors the APISIX consumer that authenticated
   * the request. Every payment intent is scoped to this record.
   */
  private resolveConsumer(consumer: GatewayConsumer) {
    return this.prisma.consumer.upsert({
      where: { apisixUsername: consumer.username },
      create: {
        apisixUsername: consumer.username,
        credentialId: consumer.credentialId,
      },
      update: { credentialId: consumer.credentialId },
    });
  }

  /** QR is derived from the stored SEP-7 URI rather than persisted. */
  private async withQr(intent: PaymentIntent): Promise<PaymentIntentView> {
    return { ...intent, qr: await QRCode.toDataURL(intent.uri) };
  }

  // ── CREATE ────────────────────────────────────────────────────────────────
  async create(
    consumer: GatewayConsumer,
    dto: CreatePaymentIntentDto,
  ): Promise<PaymentIntentView> {
    const stellar = this.config.get('stellar', { infer: true });
    const localConsumer = await this.resolveConsumer(consumer);

    // Load the payer account to obtain its current sequence number.
    const account = await this.loadAccount(dto.source);

    const builder = new TransactionBuilder(account, {
      fee: stellar.baseFee,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: dto.destination,
          amount: dto.amount,
          asset: Asset.native(), // XLM
        }),
      )
      .setTimeout(stellar.timeoutSeconds);

    if (dto.memo) {
      builder.addMemo(Memo.id(dto.memo));
    }

    const tx = builder.build();
    const xdr = tx.toXDR();
    const uri = `web+stellar:tx?xdr=${encodeURIComponent(xdr)}`;

    const intent = await this.prisma.paymentIntent.create({
      data: {
        consumerId: localConsumer.id,
        source: dto.source,
        destination: dto.destination,
        amount: dto.amount,
        asset: 'native',
        memo: dto.memo,
        network: stellar.network,
        status: 'PENDING',
        xdr,
        uri,
      },
    });

    this.logger.log(
      `Created payment intent ${intent.id}: ${dto.amount} XLM ` +
        `${dto.source} → ${dto.destination} (consumer=${consumer.username}, network=${stellar.network})`,
    );

    return this.withQr(intent);
  }

  // ── READ (list) ─────────────────────────────────────────────────────────────
  async findAll(
    consumer: GatewayConsumer,
    query: QueryPaymentIntentsDto,
  ): Promise<{ data: PaymentIntent[]; total: number; take: number; skip: number }> {
    const where = {
      consumer: { apisixUsername: consumer.username },
      ...(query.status ? { status: query.status } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.paymentIntent.findMany({
        where,
        take: query.take,
        skip: query.skip,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.paymentIntent.count({ where }),
    ]);

    return { data, total, take: query.take, skip: query.skip };
  }

  // ── READ (one) ──────────────────────────────────────────────────────────────
  async findOne(
    consumer: GatewayConsumer,
    id: string,
  ): Promise<PaymentIntentView> {
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { id, consumer: { apisixUsername: consumer.username } },
    });

    if (!intent) {
      throw new NotFoundException(`Payment intent ${id} not found`);
    }
    return this.withQr(intent);
  }

  // ── UPDATE ────────────────────────────────────────────────────────────────
  async update(
    consumer: GatewayConsumer,
    id: string,
    dto: UpdatePaymentIntentDto,
  ): Promise<PaymentIntentView> {
    // Authorize ownership before mutating.
    await this.assertOwned(consumer, id);

    const updated = await this.prisma.paymentIntent.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.txHash !== undefined ? { txHash: dto.txHash } : {}),
        ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
      },
    });

    this.logger.log(
      `Updated payment intent ${id} (consumer=${consumer.username}): ` +
        `${dto.status ?? 'status unchanged'}`,
    );
    return this.withQr(updated);
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  async remove(
    consumer: GatewayConsumer,
    id: string,
  ): Promise<{ id: string; deleted: true }> {
    await this.assertOwned(consumer, id);
    await this.prisma.paymentIntent.delete({ where: { id } });
    this.logger.log(`Deleted payment intent ${id} (consumer=${consumer.username})`);
    return { id, deleted: true };
  }

  /** Throws 404 unless the intent exists and belongs to the consumer. */
  private async assertOwned(
    consumer: GatewayConsumer,
    id: string,
  ): Promise<void> {
    const owned = await this.prisma.paymentIntent.findFirst({
      where: { id, consumer: { apisixUsername: consumer.username } },
      select: { id: true },
    });
    if (!owned) {
      throw new NotFoundException(`Payment intent ${id} not found`);
    }
  }

  private async loadAccount(source: string) {
    try {
      return await this.server.loadAccount(source);
    } catch (error: unknown) {
      // A 404 from Horizon means the account doesn't exist / isn't funded.
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      if (status === 404) {
        throw new BadRequestException(
          `Source account ${source} not found or not funded on the ${this.config.get('stellar', { infer: true }).network} network`,
        );
      }
      this.logger.error('Failed to load source account from Horizon', error);
      throw new ServiceUnavailableException(
        'Could not reach the Stellar network',
      );
    }
  }
}
