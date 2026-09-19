import { type Request, type Response } from 'express';
import { catchAsync } from '../../../src/app/utils/catchAsync.js';
import { sendResponse } from '../../../src/app/utils/sendResponse.js';
import { UserService } from '../services/user.service.js';

const getMe = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const result = await UserService.getMyProfile(userId);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'User profile retrieved successfully',
    data: result,
  });
});

const updateMe = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const result = await UserService.updateMyProfile(userId, req.body);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'User profile updated successfully',
    data: result,
  });
});

export const UserController = {
  getMe,
  updateMe,
};