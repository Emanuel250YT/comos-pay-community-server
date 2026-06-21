import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentConsumer } from '../common/decorators/current-consumer.decorator';
import { GatewayConsumer } from '../common/interfaces/gateway-consumer.interface';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { QueryPaymentIntentsDto } from './dto/query-payment-intents.dto';
import { UpdatePaymentIntentDto } from './dto/update-payment-intent.dto';
import { PaymentIntentsService } from './payment-intents.service';

// Global prefix `api` + URI versioning => /api/v1/payment-intents
@ApiTags('payment-intents')
@Controller({ path: 'payment-intents', version: '1' })
export class PaymentIntentsController {
  constructor(private readonly paymentIntents: PaymentIntentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a Stellar payment intent (persisted; returns XDR + URI + QR)',
  })
  create(
    @CurrentConsumer() consumer: GatewayConsumer,
    @Body() dto: CreatePaymentIntentDto,
  ) {
    return this.paymentIntents.create(consumer, dto);
  }

  @Get()
  @ApiOperation({ summary: "List the consumer's payment intents" })
  findAll(
    @CurrentConsumer() consumer: GatewayConsumer,
    @Query() query: QueryPaymentIntentsDto,
  ) {
    return this.paymentIntents.findAll(consumer, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a payment intent by id' })
  findOne(
    @CurrentConsumer() consumer: GatewayConsumer,
    @Param('id') id: string,
  ) {
    return this.paymentIntents.findOne(consumer, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a payment intent (status / txHash / reference)' })
  update(
    @CurrentConsumer() consumer: GatewayConsumer,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentIntentDto,
  ) {
    return this.paymentIntents.update(consumer, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a payment intent' })
  remove(
    @CurrentConsumer() consumer: GatewayConsumer,
    @Param('id') id: string,
  ) {
    return this.paymentIntents.remove(consumer, id);
  }
}
