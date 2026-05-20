from typing import Optional
from pydantic import BaseModel


class NationalIDFields(BaseModel):
    full_name_arabic: Optional[str] = None
    full_name_latin: Optional[str] = None
    cin_number: Optional[str] = None
    date_of_birth: Optional[str] = None
    expiry_date: Optional[str] = None
    place_of_birth: Optional[str] = None
    address: Optional[str] = None


class PassportFields(BaseModel):
    surname: Optional[str] = None
    given_names: Optional[str] = None
    doc_number: Optional[str] = None
    nationality: Optional[str] = None
    date_of_birth: Optional[str] = None
    expiry_date: Optional[str] = None
    sex: Optional[str] = None


class ResidencePermitFields(BaseModel):
    full_name: Optional[str] = None
    permit_number: Optional[str] = None
    date_of_birth: Optional[str] = None
    expiry_date: Optional[str] = None
    nationality: Optional[str] = None


class DriversLicenseFields(BaseModel):
    full_name: Optional[str] = None
    license_number: Optional[str] = None
    date_of_birth: Optional[str] = None
    expiry_date: Optional[str] = None
    categories: Optional[list[str]] = None
