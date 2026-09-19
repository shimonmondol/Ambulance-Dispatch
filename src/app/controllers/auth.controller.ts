import { type Request, type Response } from 'express';
import { catchAsync } from '../../../src/app/utils/catchAsync.js';
import { sendResponse } from '../../../src/app/utils/sendResponse.js';
import { AuthService } from '../services/auth.service.js';

const register = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthService.registerUser(req.body);
  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'User registered successfully',
    data: result,
  });
});

const login = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthService.loginUser(req.body);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Login successful',
    data: result,
  });
});

export const AuthController = {
  register,
  login,
};