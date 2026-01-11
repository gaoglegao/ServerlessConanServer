cmake_minimum_required(VERSION 3.15)
project(mymath VERSION 1.0.0 LANGUAGES CXX)

# 创建库
add_library(mymath src/mymath.cpp)

# 设置包含目录
target_include_directories(mymath PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
)

# 设置 C++ 标准
target_compile_features(mymath PUBLIC cxx_std_11)

# 安装规则
install(TARGETS mymath
    LIBRARY DESTINATION lib
    ARCHIVE DESTINATION lib
    RUNTIME DESTINATION bin
)

install(DIRECTORY include/ DESTINATION include)
