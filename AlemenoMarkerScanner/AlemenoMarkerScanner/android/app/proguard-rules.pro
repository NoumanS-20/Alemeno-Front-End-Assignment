# React Native default rules already cover most of the framework.
# Below: extra rules for our specific native modules.

# vision-camera frame processors (worklets)
-keep class com.mrousavy.camera.** { *; }
-keep class com.swmansion.worklets.** { *; }

# react-native-fast-opencv
-keep class com.fastopencv.** { *; }
