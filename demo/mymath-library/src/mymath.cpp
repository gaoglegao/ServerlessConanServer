#include "mymath.h"
#include <stdexcept>

namespace mymath {
    
int add(int a, int b) {
    return a + b;
}

int subtract(int a, int b) {
    return a - b;
}

int multiply(int a, int b) {
    return a * b;
}

double divide(double a, double b) {
    if (b == 0.0) {
        throw std::runtime_error("Division by zero!");
    }
    return a / b;
}

int power(int base, int exponent) {
    if (exponent < 0) {
        throw std::runtime_error("Negative exponent not supported!");
    }
    
    int result = 1;
    for (int i = 0; i < exponent; i++) {
        result *= base;
    }
    return result;
}

} // namespace mymath
