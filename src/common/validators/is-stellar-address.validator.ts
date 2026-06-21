import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { StrKey } from '@stellar/stellar-sdk';

/**
 * Validates that a value is a well-formed Stellar ed25519 public key
 * (the `G...` account address), using the SDK's StrKey checks.
 */
export function IsStellarAddress(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStellarAddress',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return (
            typeof value === 'string' && StrKey.isValidEd25519PublicKey(value)
          );
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid Stellar account address (G...)`;
        },
      },
    });
  };
}
