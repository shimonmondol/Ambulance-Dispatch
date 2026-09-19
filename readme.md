ERD Diagram
    %% Relations
    User ||--o| ProviderProfile : "has (1-to-1)"
    User ||--o{ RideRequest : "requests as customer (1-to-many)"
    User ||--o{ AuditLog : "triggers (1-to-many)"

    ProviderProfile ||--o| Ambulance : "operates (1-to-1)"
    ProviderProfile ||--o{ RideRequest : "assigned as provider (1-to-many)"

    RideRequest ||--o| Payment : "settled via (1-to-1)"

    %% Tables
    User {
        String id PK "UUID"
        String name
        String email UK
        String phone UK
        String password "Hashed"
        Role role "CUSTOMER | PROVIDER | ADMIN"
        Boolean isVerified
        DateTime deletedAt "Soft delete"
        DateTime createdAt
        DateTime updatedAt
    }

    ProviderProfile {
        String id PK "UUID"
        String userId FK, UK
        String licenseNumber UK
        Boolean isAvailable
        Float currentLat
        Float currentLng
        DateTime deletedAt "Soft delete"
    }

    Ambulance {
        String id PK "UUID"
        String registrationNo UK
        AmbulanceType type "BLS | ALS | ICU | FREEZER"
        String providerId FK, UK
        Boolean isOperational
        DateTime deletedAt "Soft delete"
        DateTime createdAt
    }

    RideRequest {
        String id PK "UUID"
        String customerId FK
        String providerId FK "Nullable until accepted"
        String pickupAddress
        Float pickupLat
        Float pickupLng
        String destination
        AmbulanceType ambulanceType
        DispatchStatus status "PENDING | ACCEPTED | EN_ROUTE | ..."
        Float fareAmount
        String cancellationReason
        DateTime deletedAt "Soft delete"
        DateTime createdAt
        DateTime updatedAt
    }

    Payment {
        String id PK "UUID"
        String rideRequestId FK, UK
        String transactionId UK
        Float amount
        String provider "BKASH | STRIPE | SSLCOMMERZ"
        PaymentStatus status "UNPAID | PENDING | PAID | FAILED | REFUNDED"
        Json paymentGatewayData
        DateTime createdAt
        DateTime updatedAt
    }

    AuditLog {
        String id PK "UUID"
        String userId FK "Nullable (system actions)"
        String action "STATUS_CHANGE | DRIVER_ASSIGN"
        String entity "RideRequest | Ambulance | User"
        String entityId
        Json metadata
        DateTime createdAt
    }