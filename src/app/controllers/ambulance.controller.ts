import { type Request, type Response } from "express";
import { catchAsync } from "../../../src/app/utils/catchAsync.js";
import { sendResponse } from "../../../src/app/utils/sendResponse.js";
import { AmbulanceService } from "../services/ambulance.service.js";

const createAmbulance = catchAsync(async (req: Request, res: Response) => {
  const result = await AmbulanceService.createAmbulance(req.body);
  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: "Ambulance created successfully",
    data: result,
  });
});

const getAllAmbulances = catchAsync(async (req: Request, res: Response) => {
  const result = await AmbulanceService.getAllAmbulances(req.query);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Ambulances retrieved successfully",
    data: result,
  });
});

const getAmbulanceById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await AmbulanceService.getAmbulanceById(id as string);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Ambulance details retrieved",
    data: result,
  });
});

const updateAmbulance = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await AmbulanceService.updateAmbulance(id as string, req.body);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Ambulance updated successfully",
    data: result,
  });
});

const softDeleteAmbulance = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await AmbulanceService.softDeleteAmbulance(id as string);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Ambulance deleted successfully",
    data: result,
  });
});

export const AmbulanceController = {
  createAmbulance,
  getAllAmbulances,
  getAmbulanceById,
  updateAmbulance,
  softDeleteAmbulance,
};
