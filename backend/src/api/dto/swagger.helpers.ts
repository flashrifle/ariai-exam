/**
 * `ApiResponse<T>` 봉투를 Swagger 스키마로 표현하는 헬퍼.
 * 응답 인터셉터가 런타임에 봉투를 씌우므로, 문서에도 같은 형태가 보이도록 맞춘다.
 */
import { Type, applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

interface EnvelopeOptions {
  /** data 가 배열인지 여부. */
  isArray?: boolean;
  description?: string;
}

/** 200 응답을 `{ success, data, error }` 봉투로 문서화한다. */
export function ApiEnvelopeOkResponse<TModel extends Type<unknown>>(
  model: TModel,
  options: EnvelopeOptions = {},
): MethodDecorator & ClassDecorator {
  const dataSchema = options.isArray
    ? { type: 'array' as const, items: { $ref: getSchemaPath(model) } }
    : { $ref: getSchemaPath(model) };

  return applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      description: options.description,
      schema: {
        type: 'object',
        required: ['success', 'data', 'error'],
        properties: {
          success: { type: 'boolean', example: true },
          data: dataSchema,
          error: { type: 'string', nullable: true, example: null },
        },
      },
    }),
  );
}
