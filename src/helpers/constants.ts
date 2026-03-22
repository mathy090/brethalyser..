export interface DriverData {
  surname: string;
  firstName: string;
  dateOfBirth: string;
  gender: "M" | "F" | "";
  idNumber: string;
  licenceNumber: string;
  licenceCode: string;
  issueDate: string;
  expiryDate: string;
}

export const EMPTY_DRIVER: DriverData = {
  surname: "",
  firstName: "",
  dateOfBirth: "",
  gender: "",
  idNumber: "",
  licenceNumber: "",
  licenceCode: "",
  issueDate: "",
  expiryDate: "",
};