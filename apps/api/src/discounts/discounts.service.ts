import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export type DiscountCodeInput = {
  code: string;
  type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  value: number;
  maxUses: number;
  validFrom: Date;
  validTo: Date;
};

export type DiscountCodeView = {
  id: string;
  code: string;
  type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  value: number;
  maxUses: number;
  usedCount: number;
  validFrom: Date;
  validTo: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ApplyDiscountResult = {
  orderId: string;
  originalTotal: number;
  discountAmount: number;
  finalTotal: number;
  discountCode: {
    id: string;
    code: string;
    type: 'PERCENTAGE' | 'FIXED_AMOUNT';
    value: number;
  };
};

const codeRegex = /^[A-Z0-9]{4,20}$/;

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function validateCodeFormat(code: string): void {
  if (!codeRegex.test(code)) {
    throw new BadRequestException(
      'Mã giảm giá chỉ được chứa chữ cái in hoa và số, độ dài 4-20 ký tự.',
    );
  }
}

function validateDiscountInput(input: DiscountCodeInput): void {
  validateCodeFormat(input.code);
  if (input.type === 'PERCENTAGE' && (input.value <= 0 || input.value > 100)) {
    throw new BadRequestException('Phần trăm giảm giá phải từ 1 đến 100.');
  }
  if (input.type === 'FIXED_AMOUNT' && input.value <= 0) {
    throw new BadRequestException('Số tiền giảm giá phải lớn hơn 0.');
  }
  if (input.maxUses <= 0) {
    throw new BadRequestException('Số lượt sử dụng tối đa phải lớn hơn 0.');
  }
  if (input.validFrom >= input.validTo) {
    throw new BadRequestException('Thời gian bắt đầu phải trước thời gian kết thúc.');
  }
}

function calculateDiscount(
  type: 'PERCENTAGE' | 'FIXED_AMOUNT',
  value: number,
  total: number,
): number {
  if (type === 'PERCENTAGE') {
    return Math.floor((total * value) / 100);
  }
  return Math.min(value, total);
}

@Injectable()
export class DiscountCodesService {
  constructor(private readonly db: PrismaService) {}

  async create(
    eventId: string,
    organizerId: string,
    input: DiscountCodeInput,
  ): Promise<DiscountCodeView> {
    await this.assertEventOwnership(eventId, organizerId);

    const normalizedCode = normalizeCode(input.code);
    validateDiscountInput({ ...input, code: normalizedCode });

    const now = new Date();
    if (input.validTo <= now) {
      throw new BadRequestException('Thời gian kết thúc phải ở tương lai.');
    }

    try {
      const discountCode = await this.db.discountCode.create({
        data: {
          code: normalizedCode,
          eventId,
          type: input.type,
          value: input.value,
          maxUses: input.maxUses,
          usedCount: 0,
          validFrom: input.validFrom,
          validTo: input.validTo,
          isActive: true,
          createdBy: organizerId,
        },
      });
      return this.toView(discountCode);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Mã giảm giá đã tồn tại.');
      }
      throw error;
    }
  }

  async findByEvent(eventId: string, organizerId: string) {
    await this.assertEventOwnership(eventId, organizerId);

    const codes = await this.db.discountCode.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
    });
    return codes.map(this.toView);
  }

  async findOne(eventId: string, codeId: string, organizerId: string) {
    await this.assertEventOwnership(eventId, organizerId);

    const discountCode = await this.db.discountCode.findUnique({
      where: { id: codeId },
    });
    if (!discountCode || discountCode.eventId !== eventId) {
      throw new NotFoundException('Không tìm thấy mã giảm giá.');
    }
    return this.toView(discountCode);
  }

  async update(
    eventId: string,
    codeId: string,
    organizerId: string,
    input: Partial<DiscountCodeInput>,
  ): Promise<DiscountCodeView> {
    await this.assertEventOwnership(eventId, organizerId);

    const existing = await this.db.discountCode.findUnique({
      where: { id: codeId },
    });
    if (!existing || existing.eventId !== eventId) {
      throw new NotFoundException('Không tìm thấy mã giảm giá.');
    }

    const updateData: Prisma.DiscountCodeUpdateInput = {};
    if (input.code) {
      validateCodeFormat(input.code);
      updateData.code = normalizeCode(input.code);
    }
    if (input.type) updateData.type = input.type;
    if (input.value !== undefined) updateData.value = input.value;
    if (input.maxUses !== undefined) updateData.maxUses = input.maxUses;
    if (input.validFrom) updateData.validFrom = input.validFrom;
    if (input.validTo) updateData.validTo = input.validTo;

    if (input.validFrom && input.validTo && input.validFrom >= input.validTo) {
      throw new BadRequestException('Thời gian bắt đầu phải trước thời gian kết thúc.');
    }
    if (input.type === 'PERCENTAGE' && input.value !== undefined && (input.value <= 0 || input.value > 100)) {
      throw new BadRequestException('Phần trăm giảm giá phải từ 1 đến 100.');
    }
    if (input.type === 'FIXED_AMOUNT' && input.value !== undefined && input.value <= 0) {
      throw new BadRequestException('Số tiền giảm giá phải lớn hơn 0.');
    }
    if (input.maxUses !== undefined && input.maxUses <= 0) {
      throw new BadRequestException('Số lượt sử dụng tối đa phải lớn hơn 0.');
    }

    const updated = await this.db.discountCode.update({
      where: { id: codeId },
      data: updateData,
    });
    return this.toView(updated);
  }

  async delete(eventId: string, codeId: string, organizerId: string): Promise<void> {
    await this.assertEventOwnership(eventId, organizerId);

    const existing = await this.db.discountCode.findUnique({
      where: { id: codeId },
    });
    if (!existing || existing.eventId !== eventId) {
      throw new NotFoundException('Không tìm thấy mã giảm giá.');
    }

    await this.db.discountCode.delete({ where: { id: codeId } });
  }

  async applyToOrder(
    orderId: string,
    userId: string,
    code: string,
  ): Promise<ApplyDiscountResult> {
    const normalizedCode = normalizeCode(code);

    const order = await this.db.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        showtime: {
          include: {
            event: true,
          },
        },
      },
    });

    if (!order || order.userId !== userId) {
      throw new NotFoundException('Không tìm thấy đơn hàng.');
    }

    if (order.status !== 'PENDING' && order.status !== 'PENDING_PAYMENT') {
      throw new BadRequestException('Chỉ áp dụng mã giảm giá cho đơn chờ thanh toán.');
    }

    const now = new Date();
    if (order.paymentExpiresAt <= now) {
      throw new BadRequestException('Đơn hàng đã hết hạn.');
    }

    if (order.discountCodeId) {
      throw new ConflictException('Đơn hàng đã áp dụng mã giảm giá khác.');
    }

    const discountCode = await this.db.discountCode.findUnique({
      where: { code: normalizedCode },
    });

    if (!discountCode) {
      throw new NotFoundException('Mã giảm giá không tồn tại.');
    }

    if (discountCode.eventId !== order.eventId) {
      throw new BadRequestException('Mã giảm giá không áp dụng cho sự kiện này.');
    }

    if (!discountCode.isActive) {
      throw new BadRequestException('Mã giảm giá đã bị vô hiệu hóa.');
    }

    if (now < discountCode.validFrom || now > discountCode.validTo) {
      throw new BadRequestException('Mã giảm giá đã hết hạn hoặc chưa có hiệu lực.');
    }

    if (discountCode.usedCount >= discountCode.maxUses) {
      throw new BadRequestException('Mã giảm giá đã hết lượt sử dụng.');
    }

    const originalTotal = order.totalAmount;
    const discountAmount = calculateDiscount(
      discountCode.type,
      discountCode.value,
      originalTotal,
    );
    const finalTotal = originalTotal - discountAmount;

    if (finalTotal < 0) {
      throw new BadRequestException('Số tiền giảm giá không được lớn hơn tổng đơn hàng.');
    }

    await this.db.$transaction(async (tx) => {
      const updatedCode = await tx.discountCode.update({
        where: { id: discountCode.id },
        data: { usedCount: { increment: 1 } },
      });
      if (updatedCode.usedCount > discountCode.maxUses) {
        throw new ConflictException('Mã giảm giá vừa hết lượt sử dụng.');
      }

      await tx.order.update({
        where: { id: orderId },
        data: {
          discountCodeId: discountCode.id,
          discountAmount,
          totalAmount: finalTotal,
        },
      });

      await tx.discountUsage.create({
        data: {
          discountCodeId: discountCode.id,
          orderId,
          amount: discountAmount,
        },
      });
    });

    return {
      orderId,
      originalTotal,
      discountAmount,
      finalTotal,
      discountCode: {
        id: discountCode.id,
        code: discountCode.code,
        type: discountCode.type,
        value: discountCode.value,
      },
    };
  }

  async removeFromOrder(orderId: string, userId: string): Promise<void> {
    const order = await this.db.order.findUnique({
      where: { id: orderId },
      include: { discountCode: true },
    });

    if (!order || order.userId !== userId) {
      throw new NotFoundException('Không tìm thấy đơn hàng.');
    }

    if (!order.discountCodeId || !order.discountCode) {
      throw new BadRequestException('Đơn hàng chưa áp dụng mã giảm giá.');
    }

    if (order.status !== 'PENDING' && order.status !== 'PENDING_PAYMENT') {
      throw new BadRequestException('Chỉ xoá mã giảm giá cho đơn chờ thanh toán.');
    }

    await this.db.$transaction(async (tx) => {
      await tx.discountCode.update({
        where: { id: order.discountCodeId! },
        data: { usedCount: { decrement: 1 } },
      });

      await tx.discountUsage.delete({
        where: {
          discountCodeId_orderId: {
            discountCodeId: order.discountCodeId!,
            orderId,
          },
        },
      });

      await tx.order.update({
        where: { id: orderId },
        data: {
          discountCodeId: null,
          discountAmount: 0,
          totalAmount: order.totalAmount + order.discountAmount,
        },
      });
    });
  }

  async validateForShowtime(
    showtimeId: string,
    code: string,
  ): Promise<{ valid: boolean; discountCode?: DiscountCodeView; error?: string }> {
    const normalizedCode = normalizeCode(code);

    const showtime = await this.db.showtime.findUnique({
      where: { id: showtimeId },
      include: { event: true },
    });
    if (!showtime) {
      return { valid: false, error: 'Không tìm thấy suất diễn.' };
    }

    const discountCode = await this.db.discountCode.findUnique({
      where: { code: normalizedCode },
    });

    if (!discountCode) {
      return { valid: false, error: 'Mã giảm giá không tồn tại.' };
    }

    if (discountCode.eventId !== showtime.eventId) {
      return { valid: false, error: 'Mã giảm giá không áp dụng cho sự kiện này.' };
    }

    const now = new Date();
    if (!discountCode.isActive) {
      return { valid: false, error: 'Mã giảm giá đã bị vô hiệu hóa.' };
    }
    if (now < discountCode.validFrom || now > discountCode.validTo) {
      return { valid: false, error: 'Mã giảm giá đã hết hạn hoặc chưa có hiệu lực.' };
    }
    if (discountCode.usedCount >= discountCode.maxUses) {
      return { valid: false, error: 'Mã giảm giá đã hết lượt sử dụng.' };
    }

    return { valid: true, discountCode: this.toView(discountCode) };
  }

  private async assertEventOwnership(eventId: string, organizerId: string): Promise<void> {
    const event = await this.db.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new NotFoundException('Không tìm thấy sự kiện.');
    }
    if (event.organizerId !== organizerId) {
      throw new ForbiddenException('Bạn không có quyền quản lý sự kiện này.');
    }
  }

  private toView(code: {
    id: string;
    code: string;
    type: 'PERCENTAGE' | 'FIXED_AMOUNT';
    value: number;
    maxUses: number;
    usedCount: number;
    validFrom: Date;
    validTo: Date;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): DiscountCodeView {
    return {
      id: code.id,
      code: code.code,
      type: code.type,
      value: code.value,
      maxUses: code.maxUses,
      usedCount: code.usedCount,
      validFrom: code.validFrom,
      validTo: code.validTo,
      isActive: code.isActive,
      createdAt: code.createdAt,
      updatedAt: code.updatedAt,
    };
  }
}