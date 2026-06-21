import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { IsStellarAddress } from '../../common/validators/is-stellar-address.validator';

export class CreatePaymentIntentDto {
  @ApiProperty({
    description: "Customer's Stellar account (the payer).",
    example: 'Greally…56charpublickey',
  })
  @IsStellarAddress()
  source!: string;

  @ApiProperty({
    description: "Merchant's Stellar account (the payee).",
    example: 'GASMERCHANT…56charpublickey',
  })
  @IsStellarAddress()
  destination!: string;

  @ApiProperty({
    description: 'Amount of XLM as a decimal string (max 7 decimal places).',
    example: '25.5',
  })
  @IsString()
  @Matches(/^\d+(\.\d{1,7})?$/, {
    message: 'amount must be a positive decimal with up to 7 decimal places',
  })
  amount!: string;

  @ApiPropertyOptional({
    description: 'Numeric memo id (uint64 as a string), e.g. an order number.',
    example: '123456789',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'memo must be a numeric id (uint64 as string)' })
  memo?: string;
}
