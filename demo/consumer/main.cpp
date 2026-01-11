#include <iostream>
#include "mymath.h"

int main() {
    int sum = mymath::add(10, 20);
    int prod = mymath::multiply(5, 6);
    
    std::cout << "10 + 20 = " << sum << std::endl;
    std::cout << "5 * 6 = " << prod << std::endl;
    
    if (sum == 30 && prod == 30) {
        std::cout << "✅ Math library works correctly!" << std::endl;
        return 0;
    } else {
        std::cout << "❌ Math library calculation error!" << std::endl;
        return 1;
    }
}
